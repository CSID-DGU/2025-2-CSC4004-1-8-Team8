import os
import logging
import numpy as np
from typing import List, Dict, Any, Optional
from fastapi import HTTPException
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics.pairwise import cosine_distances

logger = logging.getLogger("librechat.server")

# Hyperparameters
DISTANCE_THRESHOLD = 0.2  # Cosine Similarity >= 0.8
MIN_CLUSTER_SIZE = 3      # Minimum samples to form a valid cluster
MIN_SIMILARITY = 0.75     # Minimum similarity for final recommendation

async def recommend_edge_analogy(
    chroma_client,
    admin_client,
    user_id: str,
    node_id: str,
    edge_label: str,
    top_k: int = 10,
) -> List[Dict[str, Any]]:
    """
    Recommend nodes based on edge analogy (TransE style: h + r ~ t).
    
    Logic:
    1. Clustering: Group edges with similar displacement vectors using Agglomerative Clustering.
    2. Abstraction: Filter noise (small clusters) and calculate centroids.
    3. Projection: Calculate target vector = query_node + centroid.
    4. Retrieval: Find nearest nodes to target vector.
    5. Validation: Filter by minimum similarity and self-loop.
    """
    if not node_id or not edge_label:
        raise HTTPException(status_code=400, detail="node_id and edge_label are required")

    try:
        from utils.tenant_utils import ensure_tenant_exists_and_set
        await ensure_tenant_exists_and_set(chroma_client, admin_client, user_id)

        COLLECTION_NAME = os.environ.get("CHROMA_COLLECTION", "librechat_chroma")
        coll = await chroma_client.get_collection(COLLECTION_NAME)

        # 1. Get query node embedding
        node_data = await coll.get(ids=[node_id], include=["embeddings"])
        node_embs = node_data.get("embeddings", []) if node_data else []
        if not node_embs or node_embs[0] is None:
            raise HTTPException(status_code=404, detail="Embedding for node_id not found")
        query_emb = np.array(node_embs[0], dtype=np.float32)

        # 2. Get edge embeddings for the label
        edge_data = await coll.get(
            where={"$and": [{"label": edge_label}, {"type": "edge"}]},
            include=["embeddings"]
        )
        edge_embs = edge_data.get("embeddings", []) if edge_data else []
        valid_edge_embs = [e for e in edge_embs if e is not None]

        if not valid_edge_embs:
            logger.info("No edges found with label '%s'. Returning empty recommendations.", edge_label)
            return []

        edge_matrix = np.array(valid_edge_embs, dtype=np.float32)
        n_samples = edge_matrix.shape[0]
        centroids = []

        # 3. Clustering & Abstraction
        if n_samples < MIN_CLUSTER_SIZE:
            # Not enough data for clustering, but if we have at least 1, we can try mean.
            # However, spec says "Drop clusters with fewer than 3 samples".
            # If total samples < 3, strictly following spec means we return nothing.
            # But for cold start, maybe we should allow it if it's the ONLY data?
            # Let's follow spec strictly for quality: if total < 3, it's noise.
            logger.info("Too few edges (%d) for label '%s'. Minimum required: %d", n_samples, edge_label, MIN_CLUSTER_SIZE)
            return []
        else:
            # Calculate distance matrix (Cosine Distance)
            dist_matrix = cosine_distances(edge_matrix)
            
            clustering = AgglomerativeClustering(
                n_clusters=None,
                distance_threshold=DISTANCE_THRESHOLD,
                metric='precomputed',
                linkage='average'
            )
            labels = clustering.fit_predict(dist_matrix)
            
            unique_labels = set(labels)
            for label in unique_labels:
                cluster_mask = (labels == label)
                cluster_size = np.sum(cluster_mask)
                
                # Noise Filtering
                if cluster_size < MIN_CLUSTER_SIZE:
                    continue
                
                # Calculate Centroid
                cluster_vectors = edge_matrix[cluster_mask]
                centroid = np.mean(cluster_vectors, axis=0)
                centroids.append(centroid)

        if not centroids:
            logger.info("No valid clusters found for label '%s' after filtering.", edge_label)
            return []

        # 4. Projection & Retrieval
        candidate_map = {} # id -> score (keep max score)

        for centroid in centroids:
            target_vec = query_emb + centroid
            
            # Search for nearest nodes
            results = await coll.query(
                query_embeddings=[target_vec.tolist()],
                n_results=top_k + 1,
                where={"type": "node"},
                include=["distances"]
            )
            
            res_ids = results.get("ids", [[]])[0]
            res_dists = results.get("distances", [[]])[0]

            for r_id, r_dist in zip(res_ids, res_dists):
                # Sanity Check: Self-Loop
                if r_id == node_id:
                    continue
                
                # Convert distance to similarity
                # Chroma cosine distance = 1 - similarity
                score = 1.0 - r_dist
                
                # Sanity Check: Minimum Similarity
                if score < MIN_SIMILARITY:
                    continue
                
                # Keep the best score if node appears in multiple cluster searches
                if r_id in candidate_map:
                    candidate_map[r_id] = max(candidate_map[r_id], score)
                else:
                    candidate_map[r_id] = score

        # 5. Ranking
        recommendations = [
            {"id": r_id, "score": score} 
            for r_id, score in candidate_map.items()
        ]
        recommendations.sort(key=lambda x: x["score"], reverse=True)
        
        return recommendations[:top_k]

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Edge analogy recommendation failed: %s", e)
        raise HTTPException(status_code=500, detail="Edge analogy recommendation failed")

import os
import logging
from typing import List, Optional

from chromadb.api import AsyncClientAPI
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel

import numpy as np

try:
    import umap
except Exception:
    umap = None

from utils.tenant_utils import ensure_tenant_exists_and_set

logger = logging.getLogger("librechat.server")

router = APIRouter()


async def fetch_graph_and_nodes(kgraph_col, canvas_id: str):
    # Try treating canvas_id as ObjectId when possible, otherwise string
    from bson import ObjectId

    try:
        obj_id = ObjectId(canvas_id)
    except Exception:
        obj_id = canvas_id

    graph = await kgraph_col.find_one({"_id": obj_id})
    if not graph:
        raise HTTPException(status_code=404, detail="Canvas not found")
    nodes = graph.get("nodes", [])
    return {"graph": graph, "nodes": nodes}


async def fetch_all_vectors_from_chroma(chroma_client:AsyncClientAPI, collection_name: str, user_id: str):
    """
    Fetch all embeddings from Chroma for a tenant.

    Returns each id, embeddings in numpy array
    """
    # Set tenant for user isolation
    await chroma_client.set_tenant(user_id)

    coll = await chroma_client.get_collection(collection_name)

    docs = await coll.get(include=["ids", "embeddings"])

    ids_list = docs["ids"] or []
    embs_arr = docs["embeddings"] # 2d np arr


    return ids_list, embs_arr


def get_chroma_client(http_request: Request):
    return http_request.app.state.chroma
def get_admin_client(http_request: Request):
    return http_request.app.state.chroma_admin
def get_kgraph_collection(http_request: Request):
    return http_request.app.state.kgraph_collection

class UMAPRequest(BaseModel):
    user_id: str

@router.post("/calculate-umap")
async def calculate_umap(
    req: UMAPRequest,
    chroma_client=Depends(get_chroma_client),
    admin_client=Depends(get_admin_client),
    kgraph_col=Depends(get_kgraph_collection)
):
    if umap is None:
        raise HTTPException(status_code=500, detail="umap-learn is not installed")

    user_id = req.user_id
    if not user_id:
        raise HTTPException(status_code=400, detail="Missing user_id in request body")

    # Set tenant for Chroma, create if not exists
    await ensure_tenant_exists_and_set(chroma_client, admin_client, user_id)

    # TODO : env에서 가져오는 변수 -> DI, 아니면 전역 변수로 합치기
    chroma_collection = os.environ.get("CHROMA_COLLECTION", "librechat_chroma")
    try:
        ids_list, embs_arr = await fetch_all_vectors_from_chroma(
            chroma_client, chroma_collection, user_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # 4) run UMAP
    reducer = umap.UMAP(n_components=2)
    try:
        coords = reducer.fit_transform(embs_arr) #TODO: test필요, embs_arr이 np arr로 자동 변환되는지, / 
        # cpu bound라서 따로 떼어내야하는지
    except Exception as e:
        logger.exception("UMAP computation failed: %s", e)
        raise HTTPException(status_code=500, detail="UMAP computation failed")

    # 5) bulk update MongoDB: set nodes.$.x and nodes.$.y for each node
    updates = []
    from bson import ObjectId
    from pymongo import UpdateOne

    try:
        # ids_list[i] corresponds to coords[i]
        for id_str, (x, y) in zip(ids_list, coords.tolist()):
            # try converting to ObjectId for matching subdocument _id, fallback to string
            try:
                node_id = ObjectId(id_str)
            except Exception:
                node_id = id_str

            filter_q = {"nodes._id": node_id}
            update_q = {"$set": {"nodes.$.x": float(x), "nodes.$.y": float(y)}}
            updates.append(UpdateOne(filter_q, update_q))

        if not updates:
            raise HTTPException(status_code=500, detail="No updatable nodes found")

        result = await kgraph_col.bulk_write(updates)
    except Exception as e:
        logger.exception("MongoDB bulk write failed: %s", e)
        raise HTTPException(status_code=500, detail="MongoDB bulk write failed")

    # Prepare response list of {id, x, y}
    response = []
    for id_str, (x, y) in zip(ids_list, coords.tolist()):
        response.append({"id": id_str, "x": float(x), "y": float(y)})
    return response

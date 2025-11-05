import os
import logging
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel

from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction
from collection_schema import make_node_record, prepare_chroma_payload

from models import NodeItem
from utils.tenant_utils import ensure_tenant_exists_and_set

logger = logging.getLogger("librechat.server")

router = APIRouter()


class EmbedRequest(BaseModel):
    user_id: str
    nodes: List[NodeItem]


class DocumentsResult(BaseModel):
    ids: List[str]
    documents: List[Optional[str]]
    metadatas: Optional[List[Dict[str, Any]]] = None
    embeddings: Optional[List[Optional[List[float]]]] = None


def get_chroma_client(http_request: Request):
    return http_request.app.state.chroma


def get_admin_client(http_request: Request):
    return http_request.app.state.chroma_admin


@router.post("/embed/node", response_model=DocumentsResult)
async def embed_node(
    req: EmbedRequest,
    chroma_client=Depends(get_chroma_client),
    admin_client=Depends(get_admin_client)
):
    nodes = req.nodes
    user_id = req.user_id

    if not nodes:
        return []

    # Set tenant to user_id for isolation, create if not exists
    await ensure_tenant_exists_and_set(chroma_client, admin_client, user_id)

    # Get or create collection per tenant
    COLLECTION_NAME = os.environ.get("CHROMA_COLLECTION", "librechat_chroma")
    chroma_collection = await chroma_client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=OpenAIEmbeddingFunction(
            api_key=os.environ.get("OPENAI_API_KEY"),
            model_name="text-embedding-3-small"
        ),
        configuration={"hnsw": {"space": "cosine", "ef_construction": 200}},
    )

    # Prepare records for Chroma
    records = []
    for node in nodes:
        record = make_node_record(
            id=node.id,
            content=node.content,
        )
        records.append(record)

    # Prepare payload for Chroma (without embeddings, let Chroma compute them)
    ids, documents, _, _ = prepare_chroma_payload(records)

    # Add to Chroma collection (Chroma will auto-embed documents)
    await chroma_collection.add(
        ids=ids,
        documents=documents,
    )

    data = await chroma_collection.get(include=["documents", "embeddings"])  # include embeddings as requested

    return DocumentsResult(
        ids=data.get("ids", []),
        documents=data.get("documents", []),
        embeddings=data.get("embeddings", []),
    )
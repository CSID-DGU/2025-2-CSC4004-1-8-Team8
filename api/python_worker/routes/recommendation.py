
import logging
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Request, Depends, Query
from pydantic import BaseModel
from services.recommendation import service as recommendation_service
from services.recommendation import synonyms as recommendation_synonyms

logger = logging.getLogger("librechat.server")

router = APIRouter()


def get_chroma_client(http_request: Request):
	return http_request.app.state.chroma


def get_admin_client(http_request: Request):
	return http_request.app.state.chroma_admin


def get_kgraph_collection(http_request: Request):
	return http_request.app.state.kgraph_collection


class RecommendationRequest(BaseModel):
	user_id: str
	node_id: Optional[str] = None
	top_k: Optional[int] = 10


class RecommendationItem(BaseModel):
	id: str
	score: Optional[float] = None


class RecommendationResult(BaseModel):
	method: str
	recommendations: List[RecommendationItem]


@router.post("/recommendation", response_model=RecommendationResult)
async def recommendation(
	req: RecommendationRequest,
	method: str = Query("graph", description="추천 방법 (예: 'graph', 'embedding')"),
	chroma_client=Depends(get_chroma_client),
	admin_client=Depends(get_admin_client),
	kgraph_col=Depends(get_kgraph_collection),
):
	"""Recommend nodes for a user.

	- user_id: request body
	- method: query param to select recommendation strategy
	"""

	user_id = req.user_id
	node_id = req.node_id
	top_k = req.top_k or 10

	if not user_id:
		raise HTTPException(status_code=400, detail="Missing user_id in request body")

	logger.info("Recommendation requested for user_id=%s method=%s node_id=%s", user_id, method, node_id)

	# Delegate to service. We pass the chroma client now; later this can be refactored into a wrapper.
	if method == "graph":
		recommendations = await recommendation_service.recommend_graph(kgraph_col, user_id, node_id, top_k=top_k)
	elif method == "embedding":
		recommendations = await recommendation_synonyms.recommend_by_embedding(chroma_client, admin_client, user_id, node_id, top_k=top_k)
	else:
		raise HTTPException(status_code=400, detail=f"Unknown recommendation method: {method}")

	# 모델에 맞게 포맷 변환
	rec_items = [RecommendationItem(id=r["id"], score=r.get("score")) for r in recommendations]

	return RecommendationResult(method=method, recommendations=rec_items)


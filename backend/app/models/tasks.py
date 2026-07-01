from pydantic import BaseModel

class OrbitRequest(BaseModel):
    satellites: list
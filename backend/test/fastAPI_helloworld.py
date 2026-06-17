import uvicorn
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello World"}

@app.get("/status")
def read_status():
    return {"status": "ok"}
    
if __name__ == "__main__":
    # Note: When using reload=True programmatically, the application 
    # must be referenced via an import string matching the filename.
    uvicorn.run("fastAPI_helloworld:app", host="127.0.0.1", port=8000, reload=True)
    
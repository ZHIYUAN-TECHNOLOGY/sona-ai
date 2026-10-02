"""Save a training job's result to Hugging Face: Baseten's checkpoint volume fails to mount for these jobs (1 Oct), so
the job pushes its own outputs. Each stage gets its own branch of the private model repo; box ④ loads that revision.
Usage: python push.py <dir> <repo> <branch>   (needs HF_WRITE_TOKEN)
"""
import os, sys

from huggingface_hub import HfApi

folder, repo, branch = sys.argv[1:4]
api = HfApi(token=os.environ["HF_WRITE_TOKEN"])
api.create_repo(repo, private=True, exist_ok=True)
api.create_branch(repo, branch=branch, exist_ok=True)
info = api.upload_folder(repo_id=repo, folder_path=folder, revision=branch, commit_message=f"{branch}: {os.environ.get('BT_TRAINING_JOB_NAME', 'training job')}")
print("pushed", folder, "to", repo, "@", branch, info.oid)

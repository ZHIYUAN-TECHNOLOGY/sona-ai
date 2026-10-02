"""Save a training job's result to Hugging Face: Baseten's checkpoint volume fails to mount for these jobs (1 Oct), so
the job pushes its own outputs. Each stage gets its own branch of the private model repo; box ④ loads that revision.
Usage: python push.py <dir> <repo> <branch> [folder in repo]   (needs HF_WRITE_TOKEN)
Intermediate checkpoint-* folders stay behind: about 1.1 GB a stage that nothing reads, against the org's 100 GB of
private storage. So does a top-level README.md: HF validates it, and PEFT's adapter card names the local base path
("base_model ... /workspace/base-train is not valid" lost stage 2's rerun, 2 Oct).
"""
import os, sys

from huggingface_hub import HfApi

folder, repo, branch = sys.argv[1:4]
path = sys.argv[4] if len(sys.argv) > 4 else None
api = HfApi(token=os.environ["HF_WRITE_TOKEN"])
api.create_repo(repo, private=True, exist_ok=True)
api.create_branch(repo, branch=branch, exist_ok=True)
info = api.upload_folder(repo_id=repo, folder_path=folder, path_in_repo=path, revision=branch, ignore_patterns=["checkpoint-*", "*/checkpoint-*", "README.md"],
                         commit_message=f"{branch}: {os.environ.get('BT_TRAINING_JOB_NAME', 'training job')}")
print("pushed", folder, "to", repo, "@", branch, path or "", info.oid)

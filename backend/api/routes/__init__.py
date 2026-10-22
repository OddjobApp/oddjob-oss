"""
API Routes Package

Route modules are imported by the entry point that mounts them (main.py for
development, service_main.py for production). Nothing is imported here: an
eager import made every route, including the production ones, load
sentence-transformers and PyTorch.
"""

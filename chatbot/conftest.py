import os
import sys

# Defensive against pytest's non-default --import-mode=importlib (increasingly
# common), which does NOT auto-prepend a rootless module's own directory the
# way the default prepend mode does. chatbot/ has no __init__.py, so without
# this, `from main import app` breaks under that invocation mode.
sys.path.insert(0, os.path.dirname(__file__))

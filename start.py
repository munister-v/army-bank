"""Точка входу для запуску проєкту."""
from backend.app import app
from backend.config import DEBUG

if __name__ == '__main__':
    # Порт 5050: на macOS порт 5000 часто зайнятий AirPlay
    app.run(debug=DEBUG, port=5050)

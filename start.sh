#!/bin/bash

# Проверка наличия Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не установлен. Пожалуйста, установите Node.js с сайта https://nodejs.org/"
    exit 1
fi

# Проверка наличия npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm не установлен. Пожалуйста, установите Node.js с сайта https://nodejs.org/"
    exit 1
fi

# Установка зависимостей, если node_modules не существует
if [ ! -d "node_modules" ]; then
    echo "📦 Установка зависимостей..."
    npm install
fi

# Запуск сервера
echo "🚀 Запуск JARVIS AI..."
node server.js

# Открываем информацию о том, как проверить работу сервера
echo ""
echo "📝 После запуска сервера вы можете проверить его работу:"
echo "• Веб-интерфейс:  http://localhost:3000"
echo "• Проверка API:   http://localhost:3000/healthz"
echo "• Мета-данные:    http://localhost:3000/api/meta"
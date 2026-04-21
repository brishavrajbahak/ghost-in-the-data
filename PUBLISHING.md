# Publishing to GitHub (Windows)

This repo does not include secrets. Keep `backend/.env` local and rotate any keys you have exposed.

## 1) Install Git

Install **Git for Windows** and then reopen your terminal.

Verify:
```powershell
git --version
```

## 2) Initialize and commit

From the project root:
```powershell
cd D:\portfolio\ghost-in-the-data
git init
git add .
git commit -m "Ghost in the Data: V5 production-ready"
```

## 3) Create a GitHub repo + push

Create a new repository on GitHub (empty).

Then:
```powershell
git remote add origin https://github.com/<you>/ghost-in-the-data.git
git branch -M main
git push -u origin main
```

## 4) What to run (for demo)

- Dev: `docker compose up -d --build` then open `http://localhost:5173`
- Prod-like: `docker compose -f docker-compose.prod.yml up -d --build` then open `http://localhost:8080`


# 部署到 GitHub Pages

遊戲網址（部署成功後）：

**https://ray1020-a.github.io/Apollo13/**

（若你的 GitHub 帳號或倉庫名稱不同，請替換對應部分）

---

## 一次性設定（只需做一次）

### 1. 開啟 GitHub Pages

1. 打開 GitHub 倉庫：https://github.com/Ray1020-a/Apollo13
2. **Settings** → 左側 **Pages**
3. **Build and deployment** → **Source** 選 **GitHub Actions**

### 2. 推送程式碼

確認以下檔案已在 `main` 分支：

- `.github/workflows/deploy-game.yml`（自動建置與部署）
- `game/` 內完整遊戲專案

```bash
cd Apollo13
git add .
git commit -m "Add GitHub Pages deployment"
git push origin main
```

### 3. 查看部署狀態

1. 倉庫 **Actions** 分頁
2. 找到 **Deploy game to GitHub Pages** workflow
3. 綠色勾勾 = 成功，幾分鐘後可開啟上面的網址

---

## 之後每次更新

只要 `git push` 到 `main`，且改動在 `game/` 內，就會自動重新部署。

---

## 本機模擬 GitHub Pages 建置

```bash
cd game
# Windows PowerShell
$env:VITE_BASE="/Apollo13/"; npm run build; npm run preview

# 開啟 http://localhost:4173/Apollo13/ 預覽
```

---

## 若倉庫名稱不是 Apollo13

修改 `.github/workflows/deploy-game.yml` 裡的：

```yaml
VITE_BASE: /你的倉庫名/
```

網址規則：`https://<GitHub帳號>.github.io/<倉庫名>/`

---

## 注意事項

- `public/audio/bgm.mp3`、`public/textures/` 會一併打包進 `dist/`
- MP3 檔案較大時，首次載入可能較慢；若超過 GitHub 單檔 100MB 限制需改用外部 CDN
- 背景音樂在網頁上仍需**點擊畫面**才能播放（瀏覽器政策）

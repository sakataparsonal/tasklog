# TaskLog デプロイ手順

## 方法1: Vercelで公開（最も簡単・推奨）

### 1. GitHubにプッシュ（まだの場合）

```bash
# Gitリポジトリを初期化（まだの場合）
git init
git add .
git commit -m "Initial commit"

# GitHubでリポジトリを作成後
git remote add origin https://github.com/your-username/tasklog.git
git branch -M main
git push -u origin main
```

### 2. Vercelでデプロイ

1. [Vercel](https://vercel.com/)にアクセス
2. GitHubアカウントでログイン
3. 「Add New Project」をクリック
4. リポジトリを選択
5. 設定：
   - Framework Preset: Vite
   - Root Directory: ./
   - Build Command: `npm run build`
   - Output Directory: `dist`
6. 「Deploy」をクリック

### 3. 環境変数の設定（Googleカレンダー連携を使用する場合）

Vercelのプロジェクト設定で環境変数を追加：
- `VITE_GOOGLE_CLIENT_ID`: Google Client ID

## 方法2: Netlifyで公開

### 1. GitHubにプッシュ（上記と同じ）

### 2. Netlifyでデプロイ

1. [Netlify](https://www.netlify.com/)にアクセス
2. GitHubアカウントでログイン
3. 「Add new site」→「Import an existing project」
4. リポジトリを選択
5. ビルド設定：
   - Build command: `npm run build`
   - Publish directory: `dist`
6. 「Deploy site」をクリック

### 3. 環境変数の設定

Netlifyのサイト設定 → Environment variables で追加：
- `VITE_GOOGLE_CLIENT_ID`: Google Client ID

## 方法3: GitHub Pagesで公開

### 1. vite.config.tsを更新

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/tasklog/' // リポジトリ名に合わせて変更
})
```

### 2. GitHub Actionsで自動デプロイ

`.github/workflows/deploy.yml`を作成：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

### 3. GitHubリポジトリの設定

1. Settings → Pages
2. Source: GitHub Actions を選択

## ローカルでビルドを確認

```bash
npm run build
npm run preview
```

`http://localhost:4173`で確認できます。

## 注意事項

- Googleカレンダー連携を使用する場合、リダイレクトURIを本番URLに追加してください
- 環境変数は本番環境でも設定が必要です
- ビルド後のファイルは`dist`フォルダに生成されます

# Firebase Firestore セットアップ手順

## 1. Firebase プロジェクトの作成

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. 「プロジェクトを追加」をクリック
3. プロジェクト名を入力（例: `tasklog`）
4. Google Analytics の設定（任意）
5. プロジェクトを作成

## 2. Firestore データベースの作成

1. Firebase Console で「Firestore Database」をクリック
2. 「データベースを作成」をクリック
3. セキュリティールールの設定：
   - **テストモードで開始** を選択（開発中のみ）
   - または **本番モードで開始** を選択して、以下のセキュリティールールを設定

### セキュリティールール設定

Firestore Console の「ルール」タブで以下のルールを設定：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ユーザーは自分のデータのみ読み書き可能
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 3. Firebase Authentication の設定

1. Firebase Console で「Authentication」をクリック
2. 「始める」をクリック
3. 「Sign-in method」タブで「Google」を有効化
4. プロジェクトのサポートメールを設定
5. 「保存」をクリック

## 4. Web アプリの設定

1. Firebase Console のプロジェクト設定（⚙️アイコン）をクリック
2. 「マイアプリ」セクションで「</>」アイコン（Webアプリを追加）をクリック
3. アプリのニックネームを入力（例: `TaskLog Web`）
4. 「このアプリのFirebase Hostingも設定します」はチェック不要
5. 「アプリを登録」をクリック

## 5. 環境変数の設定

Firebase Console で表示される設定値を `.env` ファイルに追加：

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

## 6. 認証済みリクエストのドメインを追加

1. Firebase Console の「Authentication」→「設定」→「承認済みドメイン」
2. 使用するドメインを追加（例: `localhost`, `tasklog-yods.vercel.app`）

## データ構造

Firestore のデータ構造：

```
users/
  {userId}/
    tasks: Array<Task>
    goalsByDate: { [dateKey: string]: Goals }
    tasksDate: string (YYYY-MM-DD形式)
    updatedAt: Timestamp
```

## デプロイ時の注意

Vercel などのホスティングサービスを使用する場合：

1. Vercel のプロジェクト設定で環境変数を追加
2. すべての `VITE_FIREBASE_*` 環境変数を設定
3. デプロイ後、認証済みドメインにデプロイURLを追加

## トラブルシューティング

### エラー: "Firebase: Error (auth/popup-closed-by-user)"
- ポップアップブロッカーが有効になっている可能性があります
- ブラウザの設定でポップアップを許可してください

### エラー: "Firebase: Error (auth/unauthorized-domain)"
- Firebase Console の「認証済みドメイン」に使用中のドメインを追加してください

### データが保存されない
- Firestore のセキュリティールールが正しく設定されているか確認してください
- ブラウザの開発者ツールのコンソールでエラーを確認してください

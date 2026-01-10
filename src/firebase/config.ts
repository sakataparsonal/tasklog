import { initializeApp, FirebaseApp } from 'firebase/app'
import { getFirestore, Firestore } from 'firebase/firestore'
import { getAuth, Auth, GoogleAuthProvider } from 'firebase/auth'

// Firebase設定（環境変数から取得）
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

// 環境変数のチェック
const requiredEnvVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID'
]

const missingVars = requiredEnvVars.filter(varName => !(import.meta.env as any)[varName])

if (missingVars.length > 0) {
  console.warn('Missing Firebase environment variables:', missingVars)
  console.warn('Firebase features will not work. Please set the required environment variables.')
}

let app: FirebaseApp | null = null
let db: Firestore | null = null
let auth: Auth | null = null
let googleProvider: GoogleAuthProvider | null = null

try {
  // Firebaseアプリの初期化
  if (missingVars.length === 0) {
    console.log('✅ Firebase環境変数が正しく設定されています')
    app = initializeApp(firebaseConfig)
    db = getFirestore(app)
    auth = getAuth(app)
    googleProvider = new GoogleAuthProvider()
    console.log('✅ Firebaseが初期化されました')
  } else {
    console.error('❌ Firebase環境変数が不足しています:', missingVars)
    console.error('Firebase機能は動作しません。必要な環境変数を設定してください。')
  }
} catch (error) {
  console.error('❌ Firebaseの初期化に失敗しました:', error)
}

// Firestoreデータベース
export { db }

// 認証
export { auth, googleProvider }

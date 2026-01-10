import { 
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  GoogleAuthProvider
} from 'firebase/auth'
import { auth, googleProvider } from './config'

// Googleでログイン（Google Calendarスコープを含む）
// まずポップアップ方式を試し、失敗した場合はリダイレクト方式にフォールバック
export const signInWithGoogle = async (): Promise<{ user: User; accessToken: string | null }> => {
  if (!auth || !googleProvider) {
    throw new Error('Firebase Auth is not initialized')
  }

  try {
    // Google Calendar APIへのアクセス権限を要求
    googleProvider.addScope('https://www.googleapis.com/auth/calendar.readonly')
    
    // まずポップアップ方式を試す（Cursorブラウザなどで動作する可能性がある）
    console.log('ポップアップ方式でログインを試みます...')
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const credential = GoogleAuthProvider.credentialFromResult(result)
      console.log('✅ ポップアップ方式でログインに成功しました:', result.user.email)
      return { user: result.user, accessToken: null }
    } catch (popupError: any) {
      console.warn('ポップアップ方式が失敗しました:', popupError.code, popupError.message)
      
      // ポップアップがブロックされた場合、またはユーザーが閉じた場合、リダイレクト方式にフォールバック
      if (popupError.code === 'auth/popup-blocked' || 
          popupError.code === 'auth/popup-closed-by-user' ||
          popupError.code === 'auth/cancelled-popup-request') {
        console.log('リダイレクト方式にフォールバックします...')
        try {
          await signInWithRedirect(auth, googleProvider)
          // リダイレクトされるため、ここには到達しない
          return new Promise(() => {}) as never
        } catch (redirectError: any) {
          console.error('リダイレクト方式も失敗しました:', redirectError)
          throw redirectError
        }
      }
      // その他のエラーはそのままスロー
      throw popupError
    }
  } catch (error: any) {
    console.error('Google sign-in failed:', error)
    throw error
  }
}

// リダイレクト後の認証結果を取得
export const getGoogleSignInRedirectResult = async (): Promise<{ user: User; accessToken: string | null } | null> => {
  if (!auth || !googleProvider) {
    console.warn('⚠️ Firebase Auth または Google Provider が初期化されていません')
    return null
  }

  try {
    console.log('🔍 リダイレクト結果を確認中...')
    const result = await getRedirectResult(auth)
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result)
      const accessToken = credential?.accessToken || null
      console.log('✅ Firebase認証がリダイレクト経由で成功しました:', result.user.email)
      console.log('✅ Google Calendar アクセストークンは別途取得が必要です')
      return { user: result.user, accessToken: null }
    } else {
      console.log('ℹ️ リダイレクト結果はありません（通常のページ読み込みまたは既に認証済み）')
      return null
    }
  } catch (error: any) {
    console.error('❌ リダイレクト結果の取得に失敗しました:', error)
    console.error('エラーコード:', error.code)
    console.error('エラーメッセージ:', error.message)
    
    // エラーが発生した場合でも、認証状態はonAuthStateChangeで監視されるため、
    // エラーをスローせずにnullを返す
    if (error.code === 'auth/account-exists-with-different-credential') {
      console.error('このメールアドレスは別の認証方法で既に登録されています')
    } else if (error.code === 'auth/invalid-credential') {
      console.error('認証情報が無効です')
    }
    
    // エラーをスローして、呼び出し元で処理できるようにする
    throw error
  }
}

// Google Calendar API用のアクセストークンを取得（既にFirebaseでログインしている場合の簡略化フロー）
export const requestGoogleCalendarToken = async (_user: User): Promise<string | null> => {
  // 既存のトークンを確認
  const storedToken = localStorage.getItem('google_access_token')
  if (storedToken) {
    return storedToken
  }

  // Firebase認証でログインしている場合でも、Google Calendar API用のアクセストークンを取得する必要がある
  // 既にログインしている場合、OAuth 2.0フローは簡略化される（自動で承認される）
  const clientId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string) || ''
  if (!clientId) {
    throw new Error('Google Client ID is not set')
  }

  const redirectUri = window.location.origin
  const scope = 'https://www.googleapis.com/auth/calendar.readonly'
  // 既にログインしている場合は、prompt=consentを使用（初回のみ同意画面が表示される）
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}&prompt=consent`
  
  // リダイレクト方式でアクセストークンを取得
  window.location.href = authUrl
  
  // リダイレクトされるため、ここには到達しない
  return null
}

// Google Calendar APIのアクセストークンを取得
export const getGoogleCalendarAccessToken = async (_user: User): Promise<string | null> => {
  // localStorageから保存されたアクセストークンを取得
  const storedToken = localStorage.getItem('google_access_token')
  if (storedToken) {
    return storedToken
  }
  
  // トークンが保存されていない場合は、再ログインが必要
  return null
}

// ログアウト
export const signOut = async (): Promise<void> => {
  if (!auth) {
    throw new Error('Firebase Auth is not initialized')
  }

  try {
    await firebaseSignOut(auth)
  } catch (error) {
    console.error('Failed to sign out:', error)
    throw error
  }
}

// 認証状態の変更を監視
export const onAuthStateChange = (callback: (user: User | null) => void) => {
  if (!auth) {
    callback(null)
    return () => {} // 空の関数を返す
  }

  return onAuthStateChanged(auth, callback)
}

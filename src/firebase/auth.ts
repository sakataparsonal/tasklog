import { 
  signInWithPopup, 
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  GoogleAuthProvider
} from 'firebase/auth'
import { auth, googleProvider } from './config'

// Googleでログイン（Google Calendarスコープを含む）
export const signInWithGoogle = async (): Promise<{ user: User; accessToken: string | null }> => {
  if (!auth || !googleProvider) {
    throw new Error('Firebase Auth is not initialized')
  }

  try {
    // Google Calendar APIへのアクセス権限を要求
    googleProvider.addScope('https://www.googleapis.com/auth/calendar.readonly')
    
    const result = await signInWithPopup(auth, googleProvider)
    
    // Firebase認証の認証情報からアクセストークンを取得
    // 注意: このアクセストークンはFirebase認証用であり、Google Calendar API用のスコープを含んでいない可能性があります
    // Google Calendar API用のアクセストークンは、別途OAuth 2.0フローで取得する必要があります
    const credential = GoogleAuthProvider.credentialFromResult(result)
    const accessToken = credential?.accessToken || null
    
    // Firebase認証用のアクセストークンは、Google Calendar API用のスコープを含んでいないため、保存しない
    // Google Calendar API用のアクセストークンは、ユーザーが明示的に「Googleカレンダーからタスクを取得」ボタンを押したときに取得します
    console.log('Firebase authentication successful. Google Calendar access token will be obtained separately when needed.')
    
    return { user: result.user, accessToken: null }
  } catch (error: any) {
    console.error('Failed to sign in with Google:', error)
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

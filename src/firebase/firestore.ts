import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot,
  Timestamp 
} from 'firebase/firestore'
import { db } from './config'

export interface UserData {
  tasks: any[] // 後方互換性のため残す（非推奨）
  tasksByDate?: { [dateKey: string]: any[] } // 日付ごとのタスク
  goalsByDate: { [dateKey: string]: any }
  tasksDate?: string
  activeTaskId?: string | null
  activeTaskStartTime?: number | null
}

// ユーザーデータを読み込む
export const loadUserData = async (userId: string): Promise<UserData | null> => {
  if (!db) {
    console.error('Firestore is not initialized')
    return null
  }

  try {
    const userDocRef = doc(db, 'users', userId)
    const userDoc = await getDoc(userDocRef)
    
    if (userDoc.exists()) {
      const data = userDoc.data()
      return {
        tasks: data.tasks || [],
        goalsByDate: data.goalsByDate || {},
        tasksDate: data.tasksDate || undefined
      }
    }
    return null
  } catch (error) {
    console.error('Failed to load user data from Firestore:', error)
    return null
  }
}

// ユーザーデータを保存する
export const saveUserData = async (userId: string, data: UserData): Promise<void> => {
  if (!db) {
    console.error('Firestore is not initialized')
    throw new Error('Firestore is not initialized')
  }

  try {
    const userDocRef = doc(db, 'users', userId)
    await setDoc(userDocRef, {
      ...data,
      updatedAt: Timestamp.now()
    }, { merge: true })
  } catch (error) {
    console.error('Failed to save user data to Firestore:', error)
    throw error
  }
}

// ユーザーデータの変更を監視（リアルタイム同期）
export const subscribeUserData = (
  userId: string,
  callback: (data: UserData | null) => void
): (() => void) => {
  if (!db) {
    console.error('Firestore is not initialized')
    callback(null)
    return () => {} // 空の関数を返す
  }

  const userDocRef = doc(db, 'users', userId)
  
  const unsubscribe = onSnapshot(userDocRef, (doc) => {
    if (doc.exists()) {
      const data = doc.data()
      callback({
        tasks: data.tasks || [],
        tasksByDate: data.tasksByDate || {},
        goalsByDate: data.goalsByDate || {},
        tasksDate: data.tasksDate || undefined,
        activeTaskId: data.activeTaskId || null,
        activeTaskStartTime: data.activeTaskStartTime || null
      })
    } else {
      callback(null)
    }
  }, (error) => {
    console.error('Error listening to user data:', error)
    callback(null)
  })
  
  return unsubscribe
}

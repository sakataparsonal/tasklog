import { useState, useEffect, useRef } from 'react'
import './App.css'
import { signInWithGoogle, signOut, onAuthStateChange, getGoogleSignInRedirectResult } from './firebase/auth'
import { saveUserData, subscribeUserData } from './firebase/firestore'
import { auth, googleProvider } from './firebase/config'
import type { User } from 'firebase/auth'

interface Task {
  id: string
  name: string
  totalTime: number // ミリ秒
  sessions: Array<{ start: number; end?: number }> // セッション履歴
  color: string // タスクの色
  order: number // 並び順
  estimatedTime?: number // 予定工数時間（ミリ秒、カレンダーから取得したタスクのみ）
  scheduledStart?: number // 予定開始時間（ミリ秒、カレンダーから取得したタスクのみ）
  scheduledEnd?: number // 予定終了時間（ミリ秒、カレンダーから取得したタスクのみ）
}

interface Goal {
  id: string
  text: string
  achievementRate: number // 達成率（0-100）
}

interface Goals {
  quadrant1: Goal[] // 第一象限（3つ）
  quadrant2: Goal[] // 第二象限（3つ）
}

interface GoalsByDate {
  [dateKey: string]: Goals // 日付をキーとして目標を保存（例: "2024-01-06"）
}

const TASK_COLORS = [
  '#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe',
  '#43e97b', '#fa709a', '#fee140', '#30cfd0', '#a8edea'
]

const GOALS_STORAGE_KEY = 'tasklog-goals'

// 日付をキーに変換（YYYY-MM-DD形式）
const getDateKey = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function App() {

  // デフォルトの目標を作成
  const createDefaultGoals = (): Goals => {
    return {
      quadrant1: Array.from({ length: 3 }, (_, i) => ({ id: `q1-${i}`, text: '', achievementRate: 0 })),
      quadrant2: Array.from({ length: 3 }, (_, i) => ({ id: `q2-${i}`, text: '', achievementRate: 0 }))
    }
  }

  // 選択した日付の目標を取得
  const getGoalsForDate = (date: Date, goals: GoalsByDate): Goals => {
    const dateKey = getDateKey(date)
    return goals[dateKey] || createDefaultGoals()
  }

  // Firebase認証
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  
  const [tasks, setTasks] = useState<Task[]>([]) // 現在選択中の日付のタスク
  const [tasksByDate, setTasksByDate] = useState<{ [dateKey: string]: Task[] }>({}) // 日付ごとのタスク
  const [goalsByDate, setGoalsByDate] = useState<GoalsByDate>({})
  const [newTaskName, setNewTaskName] = useState('')
  const [selectedColor, setSelectedColor] = useState(TASK_COLORS[0])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [isGoogleCalendarConnected, setIsGoogleCalendarConnected] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date()) // 履歴表示用の日付
  const intervalRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  
  // タイムライン同期スクロール用のref
  const tasksTimelineRef = useRef<HTMLDivElement>(null)
  const executionTimelineRef = useRef<HTMLDivElement>(null)
  const isScrollingRef = useRef<boolean>(false)
  
  // 現在時刻（1分ごとに更新）
  const [currentTime, setCurrentTime] = useState(new Date())
  
  // セッション編集用のstate
  const [editingSession, setEditingSession] = useState<{
    taskId: string
    sessionIndex: number
    startTime: string
    endTime: string
  } | null>(null)
  
  // 現在時刻を1分ごとに更新
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000) // 1分ごと
    return () => clearInterval(timer)
  }, [])
  
  // ポモドーロタイマー
  const [pomodoroTime, setPomodoroTime] = useState(25 * 60) // 25分を秒で
  const [isPomodoroRunning, setIsPomodoroRunning] = useState(false)
  const [isBreak, setIsBreak] = useState(false) // true = 休憩時間, false = 作業時間
  const pomodoroIntervalRef = useRef<number | null>(null)

  // Firebase認証状態の監視
  useEffect(() => {
    // リダイレクト後の認証結果を確認（認証状態の監視より先に実行）
    getGoogleSignInRedirectResult()
      .then((result) => {
        if (result) {
          console.log('✅ リダイレクト後のログインに成功しました:', result.user.email)
          // 認証状態の変更を監視することで、自動的にuserが更新される
        } else {
          console.log('リダイレクト結果はありません（通常のページ読み込み）')
        }
      })
      .catch((error: any) => {
        console.error('❌ リダイレクト結果の取得に失敗しました:', error)
        // エラーコードに応じてメッセージを表示
        if (error.code === 'auth/account-exists-with-different-credential') {
          alert('このメールアドレスは別の認証方法で既に登録されています。')
        } else if (error.code === 'auth/invalid-credential') {
          alert('認証情報が無効です。再度ログインしてください。')
        } else if (error.code) {
          console.error('認証エラー:', error.code, error.message)
        }
      })
      .finally(() => {
        // 認証状態の監視を開始（リダイレクト結果の取得後に実行）
        setIsLoading(false)
      })

    const unsubscribe = onAuthStateChange((authUser) => {
      console.log('認証状態が変更されました:', authUser ? authUser.email : '未ログイン')
      setUser(authUser)
      setIsLoading(false)
    })
    return () => unsubscribe()
  }, [])

  // ユーザーデータをFirestoreから読み込む
  useEffect(() => {
    if (!user) {
      setTasks([])
      setGoalsByDate({})
      setIsGoogleCalendarConnected(false)
      return
    }

    // Google Calendarアクセストークンの確認
    // トークンがある場合は連携済みとして表示
    const token = localStorage.getItem('google_access_token')
    setIsGoogleCalendarConnected(!!token)

    // リアルタイム同期を開始
    const unsubscribe = subscribeUserData(user.uid, (data) => {
      if (data) {
        // tasksByDateを更新
        const firestoreTasksByDate = data.tasksByDate || {}
        
        // 後方互換性: 古いtasksデータがある場合は、tasksDateの日付に保存
        if (data.tasks && data.tasks.length > 0 && data.tasksDate) {
          const oldTasks = data.tasks
          const oldDateKey = data.tasksDate
          if (!firestoreTasksByDate[oldDateKey] || firestoreTasksByDate[oldDateKey].length === 0) {
            console.log('🔄 古いタスクデータを移行します:', oldDateKey)
            firestoreTasksByDate[oldDateKey] = oldTasks
          }
        }
        
        // tasksByDateを更新（実際に変更があった場合のみ）
        setTasksByDate(prevTasksByDate => {
          // 変更があったかどうかを確認
          const prevKeys = Object.keys(prevTasksByDate)
          const newKeys = Object.keys(firestoreTasksByDate)
          const hasChanges = prevKeys.length !== newKeys.length ||
            !prevKeys.every(key => {
              const prevTasks = prevTasksByDate[key] || []
              const newTasks = firestoreTasksByDate[key] || []
              if (prevTasks.length !== newTasks.length) return true
              const prevIds = new Set(prevTasks.map((t: Task) => t.id))
              const newIds = new Set(newTasks.map((t: Task) => t.id))
              return Array.from(prevIds).every(id => newIds.has(id)) &&
                Array.from(newIds).every(id => prevIds.has(id))
            })
          
          if (!hasChanges) {
            // 変更がない場合は更新しない（無限ループを防ぐ）
            return prevTasksByDate
          }
          
          return firestoreTasksByDate
        })
        
        // 日付が変わった場合は実行中のタスクをクリア
        const todayKey = getDateKey(new Date())
        if (data.tasksDate !== todayKey) {
          setActiveTaskId(null)
          startTimeRef.current = null
        } else {
          // 実行中のタスクを復元（今日のタスクのみ）
          if (data.activeTaskId && data.activeTaskStartTime) {
            const todayTasks = firestoreTasksByDate[todayKey] || []
            const activeTask = todayTasks.find((t: Task) => t.id === data.activeTaskId)
            
            // 実行中のセッション（endがないセッション）があるか確認
            if (activeTask && activeTask.sessions && activeTask.sessions.some((s: any) => !s.end)) {
              console.log('🔄 実行中のタスクを復元:', data.activeTaskId, '開始時刻:', data.activeTaskStartTime)
              setActiveTaskId(data.activeTaskId)
              startTimeRef.current = data.activeTaskStartTime
            } else {
              // 実行中のセッションがない場合はクリア
              if (activeTaskId !== null || startTimeRef.current !== null) {
                console.log('🔄 実行中のセッションがないため、activeTaskIdをクリア')
                setActiveTaskId(null)
                startTimeRef.current = null
              }
            }
          } else {
            // Firestoreに実行中のタスクがない場合はクリア
            if (activeTaskId !== null || startTimeRef.current !== null) {
              console.log('🔄 Firestoreに実行中のタスクがないため、activeTaskIdをクリア')
              setActiveTaskId(null)
              startTimeRef.current = null
            }
          }
          // 目標をマージ（既存の目標を保持）
          setGoalsByDate(prevGoalsByDate => {
            const firestoreGoals = data.goalsByDate || {}
            // 現在の目標とFirestoreの目標をマージ（現在の目標を優先）
            const mergedGoals = { ...firestoreGoals }
            
            // 現在の目標がある場合は、それを優先
            Object.keys(prevGoalsByDate).forEach(dateKey => {
              if (prevGoalsByDate[dateKey]) {
                mergedGoals[dateKey] = prevGoalsByDate[dateKey]
              }
            })
            
            console.log('🎯 目標をマージ:', { 
              prevGoalsCount: Object.keys(prevGoalsByDate).length,
              firestoreGoalsCount: Object.keys(firestoreGoals).length,
              mergedGoalsCount: Object.keys(mergedGoals).length
            })
            
            return mergedGoals
          })
        }
      } else {
        setTasks([])
        setGoalsByDate({})
        setActiveTaskId(null)
        startTimeRef.current = null
      }
    })

    return () => unsubscribe()
  }, [user])

  // selectedDateが変わったときに、その日付のタスクを読み込む
  useEffect(() => {
    if (!user) return
    
    const dateKey = getDateKey(selectedDate)
    const dateTasks = tasksByDate[dateKey] || []
    
    console.log('📅 selectedDateが変わりました:', dateKey)
    console.log('📅 tasksByDateのキー:', Object.keys(tasksByDate))
    console.log('📅 該当日付のタスク数:', dateTasks.length)
    console.log('📅 現在のtasks数:', tasks.length)
    
    // 必ずその日付のタスクを読み込む
    console.log('📅 タスクを読み込みます:', dateKey, 'タスク数:', dateTasks.length)
    setTasks(dateTasks)
  }, [selectedDate, user])
  
  // tasksByDateが更新されたときに、現在選択中の日付のタスクを読み込む
  // 選択中の日付のタスクIDリストを文字列化して監視
  const dateKeyForTasks = getDateKey(selectedDate)
  const dateTasksForWatch = tasksByDate[dateKeyForTasks] || []
  const dateTaskIdsString = dateTasksForWatch.map(t => t.id).sort().join(',')
  
  useEffect(() => {
    if (!user) return
    
    const dateKey = getDateKey(selectedDate)
    const dateTasks = tasksByDate[dateKey] || []
    
    console.log('📅 tasksByDateが更新されました:', dateKey, 'タスク数:', dateTasks.length)
    
    // 現在のタスクと比較（IDのみで比較して無限ループを防ぐ）
    const currentTaskIds = new Set(tasks.map(t => t.id).sort())
    const dateTaskIds = new Set(dateTasks.map(t => t.id).sort())
    const isDifferent = tasks.length !== dateTasks.length || 
      !Array.from(currentTaskIds).every(id => dateTaskIds.has(id)) ||
      !Array.from(dateTaskIds).every(id => currentTaskIds.has(id))
    
    if (isDifferent) {
      console.log('📅 タスクが異なるため、tasksを更新します:', dateKey, 'タスク数:', dateTasks.length)
      setTasks(dateTasks)
    } else {
      console.log('📅 タスクは同じため、更新しません')
    }
  }, [dateTaskIdsString, selectedDate, user])

  // Firestoreにデータを保存
  useEffect(() => {
    if (!user) return

    const saveData = async () => {
      try {
        const todayKey = getDateKey(new Date())
        const selectedDateKey = getDateKey(selectedDate)
        
        // 現在のタスクをtasksByDateに保存
        const updatedTasksByDate = { ...tasksByDate }
        updatedTasksByDate[selectedDateKey] = tasks
        
        // 実際に変更があった場合のみ保存（無限ループを防ぐ）
        const currentTasksByDate = tasksByDate[selectedDateKey] || []
        const currentTaskIds = new Set(currentTasksByDate.map(t => t.id))
        const newTaskIds = new Set(tasks.map(t => t.id))
        const hasChanges = currentTasksByDate.length !== tasks.length ||
          !Array.from(currentTaskIds).every(id => newTaskIds.has(id)) ||
          !Array.from(newTaskIds).every(id => currentTaskIds.has(id))
        
        if (!hasChanges && Object.keys(updatedTasksByDate).length === Object.keys(tasksByDate).length) {
          // 変更がない場合は保存しない
          return
        }
        
        await saveUserData(user.uid, {
          tasks: [], // 後方互換性のため空配列を保存
          tasksByDate: updatedTasksByDate,
          goalsByDate,
          tasksDate: todayKey,
          activeTaskId: activeTaskId,
          activeTaskStartTime: startTimeRef.current
        })
      } catch (error) {
        console.error('Failed to save data to Firestore:', error)
      }
    }

    // デバウンスして保存（連続した変更を防ぐ）
    const timeoutId = setTimeout(saveData, 1000)
    return () => clearTimeout(timeoutId)
  }, [tasks, tasksByDate, selectedDate, goalsByDate, activeTaskId, user])
  
  // 日付が変わったときに、その日付のタスクを自動取得
  useEffect(() => {
    if (!user) return
    
    const todayKey = getDateKey(new Date())
    const lastTasksDate = localStorage.getItem(`tasksDate_${user.uid}`)
    
    // 日付が変わった場合
    if (lastTasksDate && lastTasksDate !== todayKey) {
      console.log('📅 日付が変わりました。今日のタスクを自動取得します:', todayKey)
      setActiveTaskId(null)
      startTimeRef.current = null
      localStorage.setItem(`tasksDate_${user.uid}`, todayKey)
      
      // 今日のタスクを自動取得（Googleカレンダー連携済みの場合）
      const token = localStorage.getItem('google_access_token')
      if (token && isGoogleCalendarConnected) {
        fetchTasksFromGoogleCalendar(new Date()).catch((error) => {
          console.error('📅 自動タスク取得に失敗しました:', error)
        })
      }
    }
  }, [user, isGoogleCalendarConnected])

  // 目標をローカルストレージに保存
  useEffect(() => {
    try {
      localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goalsByDate))
    } catch (error) {
      console.error('Failed to save goals to storage:', error)
    }
  }, [goalsByDate])

  // 選択した日付の目標を取得
  const currentGoals = getGoalsForDate(selectedDate, goalsByDate)

  // 曜日ごとの背景色を取得
  const getDayBackgroundColor = (date: Date): string => {
    const day = date.getDay()
    const colors = [
      '#fff5f5', // 日曜日: 薄い赤
      '#f0f4ff', // 月曜日: 薄い青
      '#fff8e1', // 火曜日: 薄いオレンジ
      '#f1f8e9', // 水曜日: 薄い緑
      '#fffde7', // 木曜日: 薄い黄
      '#f3e5f5', // 金曜日: 薄い紫
      '#fce4ec'  // 土曜日: 薄いピンク
    ]
    return colors[day]
  }

  const dayBackgroundColor = getDayBackgroundColor(selectedDate)

  // ストップウォッチの更新（UI更新用）と自動停止チェック
  useEffect(() => {
    if (activeTaskId && startTimeRef.current) {
      intervalRef.current = window.setInterval(() => {
        // 9時間59分59秒（35999000ミリ秒）経過したら自動停止
        const MAX_DURATION = 9 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59 * 1000 // 9:59:59
        const elapsed = Date.now() - startTimeRef.current!
        
        if (elapsed >= MAX_DURATION) {
          console.log('⏰ 実行時間が9時間59分59秒を超えたため、自動停止します')
          // 自動停止処理
          const now = Date.now()
          const updatedTasks = tasks.map(task => {
            if (task.id === activeTaskId) {
              // 実行中のセッション（endがないもの）をすべて終了させる
              const updatedSessions = task.sessions.map(session => {
                if (!session.end) {
                  console.log('⏰ セッションを自動終了:', { start: session.start, end: now })
                  return { ...session, end: now }
                }
                return session
              })
              return {
                ...task,
                sessions: updatedSessions
              }
            }
            return task
          })
          
          setTasks(updatedTasks)
          setActiveTaskId(null)
          startTimeRef.current = null
          
          // tasksByDateも更新
          const selectedDateKey = getDateKey(selectedDate)
          setTasksByDate(prevTasksByDate => {
            const updated = { ...prevTasksByDate }
            updated[selectedDateKey] = updatedTasks
            return updated
          })
          
          // Firestoreに保存
          if (user) {
            const todayKey = getDateKey(new Date())
            const updatedTasksByDate = { ...tasksByDate }
            updatedTasksByDate[selectedDateKey] = updatedTasks
            saveUserData(user.uid, {
              tasks: [],
              tasksByDate: updatedTasksByDate,
              goalsByDate,
              tasksDate: todayKey,
              activeTaskId: null,
              activeTaskStartTime: null
            }).then(() => {
              console.log('⏰ Firestoreに自動停止状態を保存しました')
            }).catch((error) => {
              console.error('⏰ Firestoreへの保存に失敗しました:', error)
            })
          }
        }
      }, 1000) // 1秒ごとにチェック
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [activeTaskId, tasks, goalsByDate, user])

  // ポモドーロタイマーの更新
  useEffect(() => {
    if (isPomodoroRunning) {
      pomodoroIntervalRef.current = window.setInterval(() => {
        setPomodoroTime(prev => {
          if (prev <= 1) {
            // タイマー終了
            if (isBreak) {
              // 休憩終了 → 作業時間に切り替え
              setIsBreak(false)
              return 25 * 60
            } else {
              // 作業時間終了 → 休憩時間に切り替え
              setIsBreak(true)
              return 5 * 60
            }
          }
          return prev - 1
        })
      }, 1000)
    } else {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current)
        pomodoroIntervalRef.current = null
      }
    }

    return () => {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current)
      }
    }
  }, [isPomodoroRunning, isBreak])

  // タスク選択時にポモドーロタイマーを自動スタート
  useEffect(() => {
    if (activeTaskId && !isPomodoroRunning) {
      setIsPomodoroRunning(true)
      setIsBreak(false)
      setPomodoroTime(25 * 60)
    }
  }, [activeTaskId, isPomodoroRunning])

  // ポモドーロタイマーの制御
  const handlePomodoroToggle = () => {
    setIsPomodoroRunning(!isPomodoroRunning)
  }

  const handlePomodoroReset = () => {
    setIsPomodoroRunning(false)
    setIsBreak(false)
    setPomodoroTime(25 * 60)
  }

  // 既存のタスクに色とorderを追加（マイグレーション）
  useEffect(() => {
    if (tasks.length > 0 && tasks.some(task => !task.color || task.order === undefined)) {
      setTasks(prevTasks => {
        return prevTasks.map((task, index) => {
          const updatedTask = { ...task }
          if (!updatedTask.color) {
            updatedTask.color = TASK_COLORS[index % TASK_COLORS.length]
          }
          if (updatedTask.order === undefined) {
            updatedTask.order = index
          }
          return updatedTask
        })
      })
    }
  }, [])

  // タスク追加
  const handleAddTask = () => {
    if (newTaskName.trim()) {
      const newTask: Task = {
        id: Date.now().toString(),
        name: newTaskName.trim(),
        totalTime: 0,
        sessions: [],
        color: selectedColor,
        order: 0
      }
      const selectedDateKey = getDateKey(selectedDate)
      setTasks(prevTasks => {
        const updatedTasks = [
          newTask,
          ...prevTasks.map(task => ({ ...task, order: task.order + 1 }))
        ]
        // tasksByDateも更新
        setTasksByDate(prevTasksByDate => {
          const updated = { ...prevTasksByDate }
          updated[selectedDateKey] = updatedTasks
          return updated
        })
        return updatedTasks
      })
      setNewTaskName('')
    }
  }

  // タスク選択/停止
  const handleTaskToggle = async (taskId: string) => {
    if (activeTaskId === taskId) {
      // 停止
      const now = Date.now()
      console.log('🛑 タスクを停止:', taskId, 'now:', now)
      const updatedTasks = tasks.map(task => {
        if (task.id === taskId) {
          // 実行中のセッション（endがないもの）をすべて終了させる
          const updatedSessions = task.sessions.map(session => {
            if (!session.end) {
              console.log('🛑 セッションを終了:', { start: session.start, end: now })
              return { ...session, end: now }
            }
            return session
          })
          const hasActiveSessions = task.sessions.some(s => !s.end)
          console.log('🛑 停止処理完了:', { 
            taskName: task.name, 
            hadActiveSessions: hasActiveSessions,
            updatedSessionsCount: updatedSessions.length 
          })
          return {
            ...task,
            sessions: updatedSessions
          }
        }
        return task
      })
      setTasks(updatedTasks)
      setActiveTaskId(null)
      startTimeRef.current = null
      
      // tasksByDateも更新
      const selectedDateKey = getDateKey(selectedDate)
      setTasksByDate(prevTasksByDate => {
        const updated = { ...prevTasksByDate }
        updated[selectedDateKey] = updatedTasks
        return updated
      })
      
      // 即座にFirestoreに保存
      if (user) {
        try {
          const todayKey = getDateKey(new Date())
          const updatedTasksByDate = { ...tasksByDate }
          updatedTasksByDate[selectedDateKey] = updatedTasks
          await saveUserData(user.uid, {
            tasks: [],
            tasksByDate: updatedTasksByDate,
            goalsByDate,
            tasksDate: todayKey,
            activeTaskId: null,
            activeTaskStartTime: null
          })
          console.log('🛑 Firestoreに停止状態を保存しました')
        } catch (error) {
          console.error('🛑 Firestoreへの保存に失敗しました:', error)
        }
      }
    } else {
      // 他のタスクが実行中なら停止
      let updatedTasks = tasks
      const now = Date.now()
      
      if (activeTaskId && startTimeRef.current) {
        updatedTasks = tasks.map(task => {
          if (task.id === activeTaskId) {
            // 実行中のセッション（endがないもの）をすべて終了させる
            const updatedSessions = task.sessions.map(session => {
              if (!session.end) {
                return { ...session, end: now }
              }
              return session
            })
            return {
              ...task,
              sessions: updatedSessions
            }
          }
          return task
        })
      }
      
      // 新しいタスクを開始
      console.log('▶️ タスクを開始:', taskId, 'now:', now, 'currentActiveTaskId:', activeTaskId)
      setActiveTaskId(taskId)
      startTimeRef.current = now
      
      updatedTasks = updatedTasks.map(task => {
        if (task.id === taskId) {
          // 既に実行中のセッション（endがないもの）があるか確認
          const activeSessions = task.sessions.filter(session => !session.end)
          console.log('▶️ タスク開始処理:', {
            taskName: task.name,
            activeSessionsCount: activeSessions.length,
            allSessionsCount: task.sessions.length,
            activeTaskId: activeTaskId,
            taskId: taskId
          })
          
          if (activeSessions.length > 0) {
            // 既に実行中のセッションがある場合
            // activeTaskIdがこのタスクでない場合は、既存のセッションを終了してから新しいセッションを開始
            if (activeTaskId && activeTaskId !== taskId) {
              console.log('⚠️ 他のタスクが実行中。既存の実行中セッションを終了してから新しいセッションを開始')
              const updatedSessions = task.sessions.map(session => {
                if (!session.end) {
                  return { ...session, end: now }
                }
                return session
              })
              return {
                ...task,
                sessions: [...updatedSessions, { start: now }]
              }
            }
            // 同じタスクが既に実行中の場合、新しいセッションを追加しない
            console.log('⚠️ 既に実行中のセッションがあるため、新しいセッションを追加しません:', task.name)
            return task
          }
          // 実行中のセッションがない場合は、新しいセッションを追加
          console.log('✅ 新しいセッションを追加:', task.name)
          return {
            ...task,
            sessions: [...task.sessions, { start: now }]
          }
        }
        return task
      })
      
      setTasks(updatedTasks)
      
      // tasksByDateも更新
      const selectedDateKey = getDateKey(selectedDate)
      setTasksByDate(prevTasksByDate => {
        const updated = { ...prevTasksByDate }
        updated[selectedDateKey] = updatedTasks
        return updated
      })
      
      // 即座にFirestoreに保存
      if (user) {
        try {
          const todayKey = getDateKey(new Date())
          const updatedTasksByDate = { ...tasksByDate }
          updatedTasksByDate[selectedDateKey] = updatedTasks
          await saveUserData(user.uid, {
            tasks: [],
            tasksByDate: updatedTasksByDate,
            goalsByDate,
            tasksDate: todayKey,
            activeTaskId: taskId,
            activeTaskStartTime: now
          })
          console.log('▶️ Firestoreに開始状態を保存しました')
        } catch (error) {
          console.error('▶️ Firestoreへの保存に失敗しました:', error)
        }
      }
    }
  }

  // 時間フォーマット（時:分:秒）
  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  // 時刻フォーマット（時:分）
  const formatDateTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${hours}:${minutes}`
  }

  // 報告テキスト生成
  const generateReport = (): string => {
    const reportDate = selectedDate
    const month = reportDate.getMonth() + 1
    const date = reportDate.getDate()
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    const weekday = weekdays[reportDate.getDay()]
    const isToday = reportDate.toDateString() === new Date().toDateString()
    
    let report = `社長
竹越顧問
皆さま

お疲れ様です！
${isToday ? '本日も一日本当にありがとうございました！' : `${getDateString(reportDate)}の報告です。`}

■坂田 尚樹 ${month}/${date}(${weekday})
＝＝＝＝＝＝＝＝＝＝
■${isToday ? '本日' : getDateString(reportDate)}の最重要目標・タスク
（第１象限）
${currentGoals.quadrant1.map((goal, idx) => {
  const markers = ['➀', '②', '➂']
  return `${markers[idx]} ${goal.text || '（未入力）'}（達成率 ${goal.achievementRate}%）`
}).join('\n')}

（第２象限）
${currentGoals.quadrant2.map((goal, idx) => {
  const markers = ['➀', '②', '➂']
  return `${markers[idx]} ${goal.text || '（未入力）'}（達成率 ${goal.achievementRate}%）`
}).join('\n')}

＝＝＝＝＝＝＝＝＝＝
【${isToday ? '本日' : getDateString(reportDate)}の業務報告】
`
    
    const selectedDateStart = new Date(reportDate)
    selectedDateStart.setHours(0, 0, 0, 0)
    const selectedDateEnd = new Date(reportDate)
    selectedDateEnd.setHours(23, 59, 59, 999)
    const selectedDateStartTime = selectedDateStart.getTime()
    const selectedDateEndTime = selectedDateEnd.getTime()
    
    // 選択した日付のセッションを時間順にソート
    const allSessions: Array<{ taskName: string; start: number; end: number }> = []
    
    tasks.forEach(task => {
      task.sessions.forEach(session => {
        if (session.end) {
          if (session.end >= selectedDateStartTime && session.start <= selectedDateEndTime) {
            allSessions.push({
              taskName: task.name,
              start: Math.max(session.start, selectedDateStartTime),
              end: Math.min(session.end, selectedDateEndTime)
            })
          }
        }
      })
    })
    
    // 開始時刻でソート
    allSessions.sort((a, b) => a.start - b.start)
    
    if (allSessions.length === 0) {
      report += '本日の作業記録はありません。\n'
    } else {
      // 時間軸でグループ化（同じ時間帯のタスクをまとめる）
      const timeBlocks: Map<string, string[]> = new Map()
      
      allSessions.forEach(session => {
        const startStr = formatDateTime(session.start)
        const endStr = formatDateTime(session.end)
        const timeKey = `${startStr}～${endStr}`
        
        if (!timeBlocks.has(timeKey)) {
          timeBlocks.set(timeKey, [])
        }
        const tasks = timeBlocks.get(timeKey)!
        if (!tasks.includes(session.taskName)) {
          tasks.push(session.taskName)
        }
      })
      
      // 時間順にソートして出力
      const sortedBlocks = Array.from(timeBlocks.entries()).sort((a, b) => {
        const timeA = a[0].split('～')[0]
        const timeB = b[0].split('～')[0]
        return timeA.localeCompare(timeB)
      })
      
      sortedBlocks.forEach(([timeRange, taskNames]) => {
        report += `${timeRange}\n`
        taskNames.forEach(task => {
          report += `・${task}\n`
        })
        report += '\n'
      })
      
      // 退社時刻を追加（最後のセッションの終了時刻）
      const lastSession = allSessions[allSessions.length - 1]
      const leaveTime = formatDateTime(lastSession.end)
      report += `${leaveTime}\n退社\n`
    }
    
    return report
  }

  // 最重要目標をクリップボードにコピー
  const handleCopyGoals = async () => {
    const today = new Date()
    const month = today.getMonth() + 1
    const date = today.getDate()
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    const weekday = weekdays[today.getDay()]
    
    let goalsReport = `社長
みなさま

本日の最重要目標をご報告いたします！
本日もどうぞよろしくお願いいたします！

■${month}/${date}(${weekday})
＝＝＝＝＝＝＝＝＝＝
■第１象限目標・タスク
${currentGoals.quadrant1.map((goal, idx) => {
  const markers = ['➀', '②', '➂']
  return `${markers[idx]} ${goal.text || '（未入力）'}`
}).join('\n')}

■第２象限目標・タスク
${currentGoals.quadrant2.map((goal, idx) => {
  const markers = ['➀', '②', '➂']
  return `${markers[idx]} ${goal.text || '（未入力）'}`
}).join('\n')}
＝＝＝＝＝＝＝＝＝＝`
    
    try {
      await navigator.clipboard.writeText(goalsReport)
      alert('最重要目標をクリップボードにコピーしました！')
    } catch (err) {
      console.error('クリップボードへのコピーに失敗しました:', err)
      alert('コピーに失敗しました。')
    }
  }

  // セッション編集を開始
  const handleEditSession = (taskId: string, sessionIndex: number, start: number, end: number) => {
    const startDate = new Date(start)
    const endDate = new Date(end)
    const startTime = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`
    const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`
    setEditingSession({ taskId, sessionIndex, startTime, endTime })
  }
  
  // セッション編集を保存
  const handleSaveSession = async () => {
    if (!editingSession) return
    
    const { taskId, sessionIndex, startTime, endTime } = editingSession
    const [startHour, startMin] = startTime.split(':').map(Number)
    const [endHour, endMin] = endTime.split(':').map(Number)
    
    const newStart = new Date(selectedDate)
    newStart.setHours(startHour, startMin, 0, 0)
    const newEnd = new Date(selectedDate)
    newEnd.setHours(endHour, endMin, 0, 0)
    
    // 終了時間が開始時間より前の場合はエラー
    if (newEnd.getTime() <= newStart.getTime()) {
      alert('終了時間は開始時間より後にしてください')
      return
    }
    
    // タスクを更新
    const selectedDateKey = getDateKey(selectedDate)
    const currentTasks = tasksByDate[selectedDateKey] || []
    const updatedTasks = currentTasks.map(task => {
      if (task.id === taskId) {
        const updatedSessions = task.sessions.map((session, idx) => {
          if (idx === sessionIndex) {
            return { ...session, start: newStart.getTime(), end: newEnd.getTime() }
          }
          return session
        })
        // totalTimeを再計算
        const newTotalTime = updatedSessions.reduce((sum, s) => {
          if (s.end) return sum + (s.end - s.start)
          return sum
        }, 0)
        return { ...task, sessions: updatedSessions, totalTime: newTotalTime }
      }
      return task
    })
    
    setTasksByDate(prev => ({ ...prev, [selectedDateKey]: updatedTasks }))
    setTasks(updatedTasks)
    setEditingSession(null)
    
    // Firestoreに保存
    if (user) {
      try {
        const updatedTasksByDate = { ...tasksByDate, [selectedDateKey]: updatedTasks }
        await saveUserData(user.uid, {
          tasks: updatedTasks,
          tasksByDate: updatedTasksByDate,
          goalsByDate,
          tasksDate: getDateKey(new Date())
        })
      } catch (error) {
        console.error('セッション編集の保存に失敗:', error)
      }
    }
  }
  
  // セッションを削除
  const handleDeleteSession = async (taskId: string, sessionIndex: number) => {
    if (!window.confirm('この実績を削除しますか？')) return
    
    const selectedDateKey = getDateKey(selectedDate)
    const currentTasks = tasksByDate[selectedDateKey] || []
    const updatedTasks = currentTasks.map(task => {
      if (task.id === taskId) {
        const updatedSessions = task.sessions.filter((_, idx) => idx !== sessionIndex)
        // totalTimeを再計算
        const newTotalTime = updatedSessions.reduce((sum, s) => {
          if (s.end) return sum + (s.end - s.start)
          return sum
        }, 0)
        return { ...task, sessions: updatedSessions, totalTime: newTotalTime }
      }
      return task
    })
    
    setTasksByDate(prev => ({ ...prev, [selectedDateKey]: updatedTasks }))
    setTasks(updatedTasks)
    
    // Firestoreに保存
    if (user) {
      try {
        const updatedTasksByDate = { ...tasksByDate, [selectedDateKey]: updatedTasks }
        await saveUserData(user.uid, {
          tasks: updatedTasks,
          tasksByDate: updatedTasksByDate,
          goalsByDate,
          tasksDate: getDateKey(new Date())
        })
      } catch (error) {
        console.error('セッション削除の保存に失敗:', error)
      }
    }
  }
  
  // タイムラインのスクロール同期ハンドラ
  const handleTasksTimelineScroll = () => {
    if (isScrollingRef.current) return
    isScrollingRef.current = true
    if (tasksTimelineRef.current && executionTimelineRef.current) {
      executionTimelineRef.current.scrollTop = tasksTimelineRef.current.scrollTop
    }
    setTimeout(() => { isScrollingRef.current = false }, 10)
  }
  
  const handleExecutionTimelineScroll = () => {
    if (isScrollingRef.current) return
    isScrollingRef.current = true
    if (tasksTimelineRef.current && executionTimelineRef.current) {
      tasksTimelineRef.current.scrollTop = executionTimelineRef.current.scrollTop
    }
    setTimeout(() => { isScrollingRef.current = false }, 10)
  }

  // 報告をクリップボードにコピー
  const handleCopyReport = async () => {
    const report = generateReport()
    try {
      await navigator.clipboard.writeText(report)
      alert('報告をクリップボードにコピーしました！')
    } catch (err) {
      console.error('クリップボードへのコピーに失敗しました:', err)
      alert('クリップボードへのコピーに失敗しました')
    }
  }

  // 本日のデータをリセット
  const handleResetToday = async () => {
    if (window.confirm('選択した日付の実行時間をすべてクリアしますか？')) {
      const selectedDateStart = new Date(selectedDate)
      selectedDateStart.setHours(0, 0, 0, 0)
      const selectedDateStartTime = selectedDateStart.getTime()
      
      // タスクのセッションをクリア
      const updatedTasks = tasks.map(task => {
        // 選択した日付のセッションを除外
        const filteredSessions = task.sessions.filter(session => {
          if (session.end) {
            return session.end < selectedDateStartTime
          }
          // 実行中のセッションは今日のみ
          const isToday = selectedDate.toDateString() === new Date().toDateString()
          return session.start < selectedDateStartTime || !isToday || activeTaskId !== task.id
        })
        
        // 時間を再計算
        const remainingTime = filteredSessions.reduce((sum, session) => {
          if (session.end) {
            return sum + (session.end - session.start)
          }
          return sum
        }, 0)
        
        return {
          ...task,
          totalTime: remainingTime,
          sessions: filteredSessions
        }
      })
      
      setTasks(updatedTasks)
      
      // アクティブなタスクも停止
      if (activeTaskId) {
        setActiveTaskId(null)
        startTimeRef.current = null
      }
      
      // 即座にFirestoreに保存（デバウンスを待たない）
      if (user) {
        try {
          const todayKey = getDateKey(new Date())
          const selectedDateKey = getDateKey(selectedDate)
          const updatedTasksByDate = { ...tasksByDate }
          updatedTasksByDate[selectedDateKey] = updatedTasks
          console.log('🗑️ 実行時間をクリアしてFirestoreに保存します')
          await saveUserData(user.uid, {
            tasks: [],
            tasksByDate: updatedTasksByDate,
            goalsByDate,
            tasksDate: todayKey
          })
          console.log('🗑️ Firestoreへの保存が完了しました')
        } catch (error) {
          console.error('🗑️ Firestoreへの保存に失敗しました:', error)
        }
      }
      
      alert('選択した日付のデータをリセットしました。')
    }
  }

  // Googleカレンダーからタスクを取得（日付を指定可能）
  const fetchTasksFromGoogleCalendar = async (targetDate?: Date) => {
    const dateToFetch = targetDate || new Date()
    const dateKey = getDateKey(dateToFetch)
    console.log('🔵 fetchTasksFromGoogleCalendar called for date:', dateKey)
    
    try {
      const token = localStorage.getItem('google_access_token')
      console.log('Token exists:', !!token)
      
      if (!token) {
        console.error('No token found')
        alert('Googleカレンダーに接続してください。')
        setIsGoogleCalendarConnected(false)
        return
      }

      // 指定された日付の範囲を設定
      const dateStart = new Date(dateToFetch)
      dateStart.setHours(0, 0, 0, 0)
      const dateEnd = new Date(dateToFetch)
      dateEnd.setHours(23, 59, 59, 999)
      
      const timeMin = dateStart.toISOString()
      const timeMax = dateEnd.toISOString()
      
      console.log('Fetching events from', timeMin, 'to', timeMax)

      // Google Calendar APIを使用してイベントを取得
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`
      
      console.log('Fetching URL:', url)
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      console.log('Response status:', response.status, 'ok:', response.ok)
      
      if (response.status === 401) {
        // トークンが無効 - 再認証を試みる
        console.log('Token expired, attempting to refresh...')
        localStorage.removeItem('google_access_token')
        
        // Googleで再サインインを試みる
        try {
          const { signInWithGoogle } = await import('./firebase/auth')
          const result = await signInWithGoogle()
          if (result.accessToken) {
            localStorage.setItem('google_access_token', result.accessToken)
            console.log('Token refreshed, retrying...')
            // 再度タスク取得を試みる（再帰呼び出しを避けるため、アラートのみ表示）
            alert('認証を更新しました。もう一度「タスクを取得」ボタンを押してください。')
            return
          }
        } catch (refreshError) {
          console.error('Failed to refresh token:', refreshError)
        }
        
        setIsGoogleCalendarConnected(false)
        alert('認証が期限切れです。「連携解除」後、再度連携してください。')
        return
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('API error:', errorData)
        throw new Error(errorData.error?.message || `HTTP ${response.status}`)
      }
      
      const data = await response.json()
      console.log('API response:', data)
      console.log('Number of items:', data.items?.length || 0)
      
      if (!data.items || data.items.length === 0) {
        if (!targetDate) {
          alert('今日のイベントはありません。')
        }
        return
      }
      
      // 指定された日付の既存のタスクを取得
      const dateTasks = tasksByDate[dateKey] || []
      const currentTaskIds = new Set(dateTasks.map(t => t.id))
      
      // イベントをタスクとして追加
      const calendarTasks: Task[] = data.items
        .filter((event: any) => {
          // 終日イベントまたは日時指定イベントを処理
          if (event.start?.dateTime) {
            return true
          }
          if (event.start?.date) {
            // 終日イベントも含める
            return true
          }
          return false
        })
        .map((event: any, index: number) => {
          // 予定工数時間を計算（開始時刻と終了時刻から）
          let estimatedTime = 0
          let scheduledStart: number | undefined = undefined
          let scheduledEnd: number | undefined = undefined
          
          if (event.start?.dateTime && event.end?.dateTime) {
            // Google Calendar APIから返されるdateTimeはISO8601形式で、タイムゾーン情報を含む
            // new Date()でパースすると、自動的にローカルタイムに変換される
            const startDate = new Date(event.start.dateTime)
            const endDate = new Date(event.end.dateTime)
            
            
            scheduledStart = startDate.getTime()
            scheduledEnd = endDate.getTime()
            estimatedTime = scheduledEnd - scheduledStart
          } else if (event.start?.date && event.end?.date) {
            // 終日イベントの場合、1日分として計算（8時間 = 28800000ミリ秒）
            // 終日イベントのdateはYYYY-MM-DD形式で、タイムゾーン情報なし
            const dateStr = event.start.date
            const [year, month, day] = dateStr.split('-').map(Number)
            const startDate = new Date(year, month - 1, day, 9, 0, 0, 0)
            const endDate = new Date(year, month - 1, day, 17, 0, 0, 0)
            
            scheduledStart = startDate.getTime()
            scheduledEnd = endDate.getTime()
            estimatedTime = 8 * 60 * 60 * 1000
          }
          
          return {
            id: `calendar-${event.id}`,
            name: event.summary || '無題のイベント',
            totalTime: 0,
            sessions: [],
            color: TASK_COLORS[index % TASK_COLORS.length],
            order: dateTasks.length + index,
            estimatedTime: estimatedTime > 0 ? estimatedTime : undefined,
            scheduledStart: scheduledStart,
            scheduledEnd: scheduledEnd
          }
        })
      
      console.log('🟢 Calendar tasks created:', calendarTasks.length)
      console.log('[DEBUG] Task names:', calendarTasks.map(t => t.name))
      console.log('[DEBUG] Task IDs:', calendarTasks.map(t => t.id))
      
      // 既存のタスクと統合（カレンダータスクは時間データを更新）
      console.log('[DEBUG] Existing task IDs:', Array.from(currentTaskIds))
      
      // 既存のカレンダータスク（calendar-で始まるID）の時間データを更新（セッションは保持）
      const updatedDateTasks = dateTasks.map(existingTask => {
        if (existingTask.id.startsWith('calendar-')) {
          const calendarTask = calendarTasks.find(ct => ct.id === existingTask.id)
          if (calendarTask) {
            console.log('[DEBUG] Updating existing calendar task:', existingTask.name, {
              oldStart: existingTask.scheduledStart ? new Date(existingTask.scheduledStart).toString() : 'undefined',
              newStart: calendarTask.scheduledStart ? new Date(calendarTask.scheduledStart).toString() : 'undefined',
              sessionsCount: existingTask.sessions.length,
              totalTime: existingTask.totalTime
            })
            // 既存のセッションとtotalTimeを保持しつつ、スケジュール情報のみ更新
            return {
              ...existingTask,
              sessions: existingTask.sessions, // 明示的にセッションを保持
              totalTime: existingTask.totalTime, // 明示的にtotalTimeを保持
              scheduledStart: calendarTask.scheduledStart,
              scheduledEnd: calendarTask.scheduledEnd,
              estimatedTime: calendarTask.estimatedTime
            }
          }
        }
        return existingTask
      })
      
      const newTasks = calendarTasks.filter(t => {
        const isNew = !currentTaskIds.has(t.id)
        if (!isNew) {
          console.log('[DEBUG] Task already exists (will be updated):', t.name, t.id)
        }
        return isNew
      })
      
      console.log('🟢 New tasks to add:', newTasks.length)
      console.log('[DEBUG] New task names:', newTasks.map(t => t.name))
      console.log('[DEBUG] New task IDs:', newTasks.map(t => t.id))
      
      // 既存タスク（時間データ更新済み）と新しいタスクを統合
      const finalDateTasks = [...updatedDateTasks, ...newTasks]
      
      console.log('📅 タスクをtasksByDateに保存します:', dateKey, 'タスク数:', finalDateTasks.length)
      
      // tasksByDateを更新（新しいタスクがなくても、時間データの更新があるので常に保存）
      setTasksByDate(prevTasksByDate => {
        const updated = { ...prevTasksByDate }
        updated[dateKey] = finalDateTasks
        console.log('📅 tasksByDateを更新しました:', Object.keys(updated))
        return updated
      })
      
      // 現在選択中の日付の場合は、tasksも更新
      const currentSelectedDateKey = getDateKey(selectedDate)
      if (dateKey === currentSelectedDateKey) {
        console.log('📅 現在選択中の日付のため、tasksも更新します')
        setTasks(finalDateTasks)
      } else {
        console.log('📅 現在選択中の日付ではないため、tasksは更新しません:', dateKey, 'vs', currentSelectedDateKey)
      }
      
      // タスク取得完了メッセージを表示
      if (newTasks.length > 0) {
        alert(`${newTasks.length}件の新しいタスクを取得しました。`)
      } else if (calendarTasks.length > 0) {
        alert(`${calendarTasks.length}件のタスクを更新しました。`)
      } else {
        alert('カレンダーにタスクがありませんでした。')
      }
    } catch (error: any) {
      console.error('Failed to fetch from Google Calendar:', error)
      if (error.message?.includes('401') || error.message?.includes('認証')) {
        localStorage.removeItem('google_access_token')
        setIsGoogleCalendarConnected(false)
        alert('認証が期限切れです。「連携解除」後、再度連携してください。')
      } else {
        alert(`Googleカレンダーからの取得に失敗しました: ${error.message || '不明なエラー'}`)
      }
    }
  }


  // 日付と曜日を取得
  const getDateString = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    const weekday = weekdays[date.getDay()]
    return `${year}年${month}月${day}日(${weekday})`
  }

  // 選択した日付のデータを取得
  const getSelectedDateData = () => {
    const selectedDateStart = new Date(selectedDate)
    selectedDateStart.setHours(0, 0, 0, 0)
    const selectedDateEnd = new Date(selectedDate)
    selectedDateEnd.setHours(23, 59, 59, 999)
    const selectedDateStartTime = selectedDateStart.getTime()
    const selectedDateEndTime = selectedDateEnd.getTime()
    const isToday = selectedDate.toDateString() === new Date().toDateString()

    // 選択した日付のセッションを取得
    const allSessions: Array<{ 
      taskId: string
      sessionIndex: number
      taskName: string
      taskColor: string
      start: number
      end: number
      isActive: boolean
    }> = []
    
    // 実行中のセッションを追跡（各タスクにつき1つだけ）
    const activeSessionByTask = new Map<string, { taskId: string; sessionIndex: number; start: number }>()
    
    tasks.forEach(task => {
      task.sessions.forEach((session, sessionIndex) => {
        // session.startが正しく設定されていることを確認
        if (!session.start || session.start <= 0) {
          return // 不正なstart値のセッションはスキップ
        }
        
        if (session.end) {
          // 終了済みセッション
          if (session.end >= selectedDateStartTime && session.start <= selectedDateEndTime) {
            allSessions.push({
              taskId: task.id,
              sessionIndex,
              taskName: task.name,
              taskColor: task.color || TASK_COLORS[0],
              start: Math.max(session.start, selectedDateStartTime),
              end: Math.min(session.end, selectedDateEndTime),
              isActive: false
            })
          }
        } else if (isToday && activeTaskId === task.id && session.start >= selectedDateStartTime) {
          // 実行中のセッション（今日のみ）- 各タスクにつき最新の1つだけを追加
          const existing = activeSessionByTask.get(task.id)
          if (!existing || session.start > existing.start) {
            activeSessionByTask.set(task.id, { taskId: task.id, sessionIndex, start: session.start })
          }
        }
      })
    })
    
    // 実行中のセッションを追加（各タスクにつき1つだけ）
    activeSessionByTask.forEach((activeSession, taskId) => {
      const task = tasks.find(t => t.id === taskId)
      if (task) {
        allSessions.push({
          taskId: task.id,
          sessionIndex: activeSession.sessionIndex,
          taskName: task.name,
          taskColor: task.color || TASK_COLORS[0],
          start: activeSession.start,
          end: Date.now(),
          isActive: true
        })
      }
    })
    
    // 開始時刻でソート（実行中のタスクも含めて時系列順に）
    allSessions.sort((a, b) => {
      // 開始時刻でソート（数値として比較）
      const startDiff = a.start - b.start
      if (startDiff !== 0) {
        return startDiff
      }
      // 開始時刻が同じ場合は、実行中のタスクを後ろに
      if (a.isActive && !b.isActive) return 1
      if (!a.isActive && b.isActive) return -1
      return 0
    })
    
    return allSessions
  }

  // タスク削除
  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation() // タスク選択のイベントを防ぐ
    e.preventDefault() // デフォルトの動作を防ぐ
    console.log('🗑️ タスク削除ボタンがクリックされました:', taskId)
    
    if (window.confirm('このタスクを削除しますか？')) {
      console.log('🗑️ タスクを削除します:', taskId)
      
      // タスクを削除
      const selectedDateKey = getDateKey(selectedDate)
      const filteredTasks = tasks.filter(task => task.id !== taskId)
      console.log('🗑️ 削除前のタスク数:', tasks.length, '削除後のタスク数:', filteredTasks.length)
      
      setTasks(filteredTasks)
      
      // tasksByDateも更新
      setTasksByDate(prevTasksByDate => {
        const updated = { ...prevTasksByDate }
        updated[selectedDateKey] = filteredTasks
        return updated
      })
      
      if (activeTaskId === taskId) {
        console.log('🗑️ 実行中のタスクを削除したため、activeTaskIdをクリア')
        setActiveTaskId(null)
        startTimeRef.current = null
      }
      
      // 即座にFirestoreに保存（デバウンスを待たない）
      if (user) {
        try {
          const todayKey = getDateKey(new Date())
          const updatedTasksByDate = { ...tasksByDate }
          updatedTasksByDate[selectedDateKey] = filteredTasks
          console.log('🗑️ Firestoreに削除後のタスクを即座に保存します')
          await saveUserData(user.uid, {
            tasks: [],
            tasksByDate: updatedTasksByDate,
            goalsByDate,
            tasksDate: todayKey
          })
          console.log('🗑️ Firestoreへの保存が完了しました')
        } catch (error) {
          console.error('🗑️ Firestoreへの保存に失敗しました:', error)
        }
      }
    } else {
      console.log('🗑️ タスク削除がキャンセルされました')
    }
  }

  // 目標を更新
  const handleGoalUpdate = (quadrant: 'quadrant1' | 'quadrant2', index: number, field: 'text' | 'achievementRate', value: string | number) => {
    const dateKey = getDateKey(selectedDate)
    console.log('🎯 目標を更新:', { quadrant, index, field, value, dateKey })
    
    setGoalsByDate(prevGoalsByDate => {
      const newGoalsByDate = { ...prevGoalsByDate }
      const currentGoals = newGoalsByDate[dateKey] || createDefaultGoals()
      
      // 深いコピーを作成
      const newGoals: Goals = {
        quadrant1: currentGoals.quadrant1.map(g => ({ ...g })),
        quadrant2: currentGoals.quadrant2.map(g => ({ ...g }))
      }
      
      const goal = { ...newGoals[quadrant][index] }
      
      if (field === 'text') {
        goal.text = value as string
      } else {
        goal.achievementRate = Math.max(0, Math.min(100, value as number))
      }
      
      newGoals[quadrant] = [...newGoals[quadrant]]
      newGoals[quadrant][index] = goal
      newGoalsByDate[dateKey] = newGoals
      
      console.log('🎯 更新後の目標:', newGoalsByDate[dateKey])
      console.log('🎯 更新後の目標（quadrant）:', newGoalsByDate[dateKey]?.[quadrant])
      
      return newGoalsByDate
    })
  }

  // 前日の目標をコピー
  const handleCopyPreviousDayGoals = () => {
    const prevDate = new Date(selectedDate)
    prevDate.setDate(prevDate.getDate() - 1)
    const prevDateKey = getDateKey(prevDate)
    const currentDateKey = getDateKey(selectedDate)
    
    const prevGoals = goalsByDate[prevDateKey]
    if (!prevGoals) {
      alert('前日の目標が見つかりません。')
      return
    }
    
    // 前日の目標をコピー（新しいIDを生成）
    const copiedGoals: Goals = {
      quadrant1: prevGoals.quadrant1.map((goal, idx) => ({
        id: `q1-${idx}`,
        text: goal.text,
        achievementRate: goal.achievementRate
      })),
      quadrant2: prevGoals.quadrant2.map((goal, idx) => ({
        id: `q2-${idx}`,
        text: goal.text,
        achievementRate: goal.achievementRate
      }))
    }
    
    setGoalsByDate(prevGoalsByDate => ({
      ...prevGoalsByDate,
      [currentDateKey]: copiedGoals
    }))
    
    alert('前日の目標をコピーしました。')
  }

  // ログイン処理
  const handleLogin = async () => {
    try {
      // Firebaseが初期化されているか確認
      if (!auth || !googleProvider) {
        alert('Firebaseが初期化されていません。環境変数が正しく設定されているか確認してください。\n\nブラウザのコンソール（F12キー）で詳細を確認してください。')
        console.error('Firebase Auth is not initialized. Check environment variables.')
        return
      }
      
      const result = await signInWithGoogle()
      // Firebase認証完了、アクセストークンがあれば保存
      if (result.accessToken) {
        localStorage.setItem('google_access_token', result.accessToken)
        setIsGoogleCalendarConnected(true)
        console.log('Firebase login successful with access token.')
      } else {
        console.log('Firebase login successful. Access token will be obtained via OAuth flow.')
      }
    } catch (error: any) {
      console.error('Login failed:', error)
      
      // エラーの種類に応じて詳細なメッセージを表示
      let errorMessage = 'ログインに失敗しました。'
      
      if (error.code === 'auth/popup-closed-by-user') {
        errorMessage = 'ログインがキャンセルされました。再度お試しください。'
      } else if (error.code === 'auth/unauthorized-domain') {
        errorMessage = 'このドメインは認証されていません。Firebase Consoleで承認済みドメインに追加してください。'
      } else if (error.code === 'auth/popup-blocked') {
        // リダイレクト方式に自動フォールバックするため、エラーを表示しない
        console.log('Popup blocked, redirecting to Google sign-in...')
        return
      } else if (error.message?.includes('Firebase Auth is not initialized')) {
        errorMessage = 'Firebaseが初期化されていません。環境変数が正しく設定されているか確認してください。'
      } else if (error.message) {
        errorMessage = `ログインに失敗しました: ${error.message}`
      }
      
      alert(errorMessage + '\n\nブラウザのコンソール（F12キー）で詳細を確認してください。')
    }
  }
  
  // OAuthコールバック処理（Google Calendar API用のアクセストークン取得）
  useEffect(() => {
    console.log('🟡🟡🟡 OAuth callback useEffect 実行開始 🟡🟡🟡')
    console.log('[DEBUG] ==========================================')
    console.log('[DEBUG] OAuth callback useEffect')
    console.log('[DEBUG] ==========================================')
    console.log('[DEBUG] User:', user ? { uid: user.uid, email: user.email } : 'null')
    console.log('[DEBUG] Hash:', window.location.hash ? window.location.hash.substring(0, 100) + '...' : 'empty')
    console.log('[DEBUG] Full URL:', window.location.href)
    
    if (!user) {
      console.log('🟡 [DEBUG] ユーザーがログインしていません')
      // ハッシュにaccess_tokenが含まれている場合は、一時的に保存しておく
      if (window.location.hash.includes('access_token=')) {
        console.log('🟡 [DEBUG] アクセストークンがハッシュに含まれていますが、ユーザーが未ログインです')
        console.log('🟡 [DEBUG] ハッシュを一時保存して、ユーザーログイン後に処理します')
        // ハッシュをsessionStorageに一時保存
        sessionStorage.setItem('pending_oauth_hash', window.location.hash)
        console.log('🟡 [DEBUG] ハッシュをsessionStorageに保存しました')
        // ハッシュはクリアしない（ユーザーがログインした後に処理するため）
      }
      console.log('[DEBUG] ==========================================')
      console.log('[DEBUG] OAuth callback useEffect 終了（ユーザー未ログイン）')
      console.log('[DEBUG] ==========================================')
      return
    }
    
    // ユーザーがログインしている場合、保存されたハッシュがあるか確認
    const savedHash = sessionStorage.getItem('pending_oauth_hash')
    if (savedHash) {
      console.log('🟢 [DEBUG] 保存されていたハッシュを復元します')
      console.log('[DEBUG] Saved hash:', savedHash.substring(0, 100) + '...')
      // ハッシュを復元
      window.location.hash = savedHash
      sessionStorage.removeItem('pending_oauth_hash')
      console.log('🟢 [DEBUG] ハッシュを復元しました')
    }
    
    const hash = window.location.hash
    console.log('[DEBUG] ==========================================')
    console.log('[DEBUG] ハッシュ確認')
    console.log('[DEBUG] ==========================================')
    console.log('[DEBUG] Hash exists:', !!hash)
    console.log('[DEBUG] Hash length:', hash.length)
    console.log('[DEBUG] Hash content:', hash ? hash.substring(0, 150) + '...' : 'empty')
    console.log('[DEBUG] Hash includes access_token:', hash.includes('access_token='))
    console.log('[DEBUG] Hash includes error:', hash.includes('error='))
    
    // エラーチェック
    if (hash.includes('error=')) {
      const error = hash.split('error=')[1].split('&')[0]
      const decodedError = decodeURIComponent(error)
      console.error('🔴 OAuth error:', decodedError)
      if (!decodedError.includes('access_denied')) {
        // access_denied以外のエラーは表示
        alert(`認証エラー: ${decodedError}`)
      }
      window.location.hash = ''
      sessionStorage.removeItem('google_calendar_token_requested')
      return
    }
    
    // アクセストークンの取得（Google Calendar API用）
    if (hash.includes('access_token=')) {
      console.log('🟢🟢🟢 OAuth callback: access_token found 🟢🟢🟢')
      console.log('[DEBUG] ==========================================')
      console.log('[DEBUG] OAuth認証成功 - トークン処理開始')
      console.log('[DEBUG] ==========================================')
      console.log('[DEBUG] Hash length:', hash.length)
      console.log('[DEBUG] Hash preview:', hash.substring(0, 150) + '...')
      console.log('[DEBUG] User:', { uid: user.uid, email: user.email })
      
      try {
        const tokenMatch = hash.match(/access_token=([^&]+)/)
        if (!tokenMatch) {
          console.error('🔴 [DEBUG] Failed to extract access token from hash')
          console.error('[DEBUG] Hash:', hash)
          alert('アクセストークンの取得に失敗しました。再度お試しください。')
          window.location.hash = ''
          return
        }
        
        const decodedToken = decodeURIComponent(tokenMatch[1])
        console.log('🟢 [DEBUG] Token extracted successfully')
        console.log('[DEBUG] Token length:', decodedToken.length)
        console.log('[DEBUG] Token preview:', decodedToken.substring(0, 30) + '...')
        
        // トークンを保存
        localStorage.setItem('google_access_token', decodedToken)
        console.log('🟢 [DEBUG] Token saved to localStorage')
        
        // 保存されたトークンを確認
        const savedToken = localStorage.getItem('google_access_token')
        console.log('[DEBUG] Saved token verified:', savedToken ? `exists (length: ${savedToken.length})` : 'NOT FOUND')
        
        // ハッシュをクリア
        window.location.hash = ''
        sessionStorage.removeItem('google_calendar_token_requested')
        setIsGoogleCalendarConnected(true)
        console.log('🟢 [DEBUG] isGoogleCalendarConnected set to true')
        
        // 自動でカレンダーからタスクを取得
        console.log('🟣🟣🟣 OAuth認証成功、自動でタスクを取得します 🟣🟣🟣')
        console.log('[DEBUG] ==========================================')
        console.log('[DEBUG] 自動タスク取得処理開始')
        console.log('[DEBUG] ==========================================')
        console.log('[DEBUG] User info:', { uid: user.uid, email: user.email })
        console.log('[DEBUG] Waiting 1.5 seconds before fetching...')
        
        // 少し待ってからタスクを取得（ページの再レンダリングを待つ）
        setTimeout(() => {
          console.log('[DEBUG] ==========================================')
          console.log('[DEBUG] タイムアウト完了、タスク取得開始')
          console.log('[DEBUG] ==========================================')
          console.log('[DEBUG] Current user:', user ? { uid: user.uid, email: user.email } : 'null')
          
          const tokenCheck = localStorage.getItem('google_access_token')
          console.log('[DEBUG] Token check before fetch:', tokenCheck ? `exists (length: ${tokenCheck.length})` : 'NOT FOUND')
          
          fetchTasksFromGoogleCalendar().then(() => {
            console.log('🟢 [DEBUG] fetchTasksFromGoogleCalendar completed successfully')
          }).catch((err: any) => {
            console.error('🔴 [DEBUG] fetchTasksFromGoogleCalendar failed:', err)
            console.error('[DEBUG] Error message:', err.message)
            console.error('[DEBUG] Error stack:', err.stack)
            alert(`タスクの取得に失敗しました: ${err.message || '不明なエラー'}\n\nブラウザのコンソール（F12キー）で詳細を確認してください。`)
          })
        }, 1500)
      } catch (error: any) {
        console.error('🔴 [DEBUG] Error processing OAuth callback:', error)
        console.error('[DEBUG] Error message:', error.message)
        console.error('[DEBUG] Error stack:', error.stack)
        alert(`認証処理中にエラーが発生しました: ${error.message || '不明なエラー'}`)
        window.location.hash = ''
      }
    } else {
      console.log('🟡 ハッシュにaccess_tokenが含まれていません')
    }
  }, [user])

  // ログアウト処理
  const handleLogout = async () => {
    try {
      // ログアウト前に確実にFirestoreに保存
      if (user) {
        try {
          const todayKey = getDateKey(new Date())
          const selectedDateKey = getDateKey(selectedDate)
          const updatedTasksByDate = { ...tasksByDate }
          updatedTasksByDate[selectedDateKey] = tasks
          console.log('🚪 ログアウト前にデータを保存します')
          await saveUserData(user.uid, {
            tasks: [],
            tasksByDate: updatedTasksByDate,
            goalsByDate,
            tasksDate: todayKey,
            activeTaskId: activeTaskId,
            activeTaskStartTime: startTimeRef.current
          })
          console.log('🚪 ログアウト前の保存が完了しました')
        } catch (error) {
          console.error('🚪 ログアウト前の保存に失敗しました:', error)
          // 保存に失敗してもログアウトは続行
        }
      }
      
      await signOut()
      setTasks([])
      setGoalsByDate({})
      setActiveTaskId(null)
      startTimeRef.current = null
      setIsGoogleCalendarConnected(false)
      localStorage.removeItem('google_access_token')
    } catch (error: any) {
      console.error('Logout failed:', error)
      alert('ログアウトに失敗しました。')
    }
  }

  // ローディング中
  if (isLoading) {
    return (
      <div className="app" style={{ backgroundColor: dayBackgroundColor, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', color: '#666' }}>読み込み中...</div>
        </div>
      </div>
    )
  }

  // ログインしていない場合
  if (!user) {
    return (
      <div className="app" style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '40px', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '20px', color: '#333' }}>TaskLog</h1>
          <p style={{ marginBottom: '30px', color: '#666' }}>Googleアカウントでログインしてください</p>
          <button 
            onClick={handleLogin}
            style={{
              padding: '12px 24px',
              backgroundColor: '#4285f4',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.3s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#357ae8'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#4285f4'}
          >
            Googleでログイン
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app" style={{ backgroundColor: dayBackgroundColor, minHeight: '100vh' }}>
      <div className="container">
        <div className="header-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>TaskLog</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <span style={{ fontSize: '0.9rem', color: '#666' }}>{user.displayName || user.email}</span>
              <button 
                onClick={handleLogout}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'background 0.3s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#d32f2f'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f44336'}
              >
                ログアウト
              </button>
            </div>
          </div>
          <div className="date-selector-section">
            <div className="date-selector">
              <button 
                onClick={() => {
                  const prevDate = new Date(selectedDate)
                  prevDate.setDate(prevDate.getDate() - 1)
                  setSelectedDate(prevDate)
                }}
                className="date-nav-button"
              >
                ← 前日
              </button>
              <div className="selected-date">
                {getDateString(selectedDate)}
                {selectedDate.toDateString() === new Date().toDateString() && ' (今日)'}
              </div>
              <button 
                onClick={() => {
                  const nextDate = new Date(selectedDate)
                  nextDate.setDate(nextDate.getDate() + 1)
                  const today = new Date()
                  if (nextDate <= today) {
                    setSelectedDate(nextDate)
                  }
                }}
                className="date-nav-button"
                disabled={selectedDate.toDateString() === new Date().toDateString()}
              >
                翌日 →
              </button>
            </div>
          </div>
        </div>
        
        {/* 最重要目標セクション */}
        <div className="goals-section">
          <div className="goals-header">
            <h2>最重要目標</h2>
            <button onClick={handleCopyPreviousDayGoals} className="copy-previous-goals-button">
              前日の目標を複写する
            </button>
          </div>
          <div className="goals-container">
            <div className="goal-quadrant">
              <h3>第１象限</h3>
              {currentGoals.quadrant1.map((goal, idx) => (
                <div key={goal.id} className="goal-item">
                  <div className="goal-number">{idx === 0 ? '➀' : idx === 1 ? '②' : '➂'}</div>
                  <input
                    type="text"
                    value={goal.text}
                    onChange={(e) => handleGoalUpdate('quadrant1', idx, 'text', e.target.value)}
                    placeholder="目標を入力..."
                    className="goal-input"
                  />
                  <select
                    value={goal.achievementRate}
                    onChange={(e) => handleGoalUpdate('quadrant1', idx, 'achievementRate', parseInt(e.target.value))}
                    className="goal-rate-select"
                    style={{
                      backgroundColor: goal.achievementRate <= 50 ? '#ffebee' : 
                                      goal.achievementRate <= 70 ? '#fff9e6' : 
                                      goal.achievementRate <= 90 ? '#e8f5e9' : 
                                      '#e3f2fd',
                      color: goal.achievementRate <= 50 ? '#c62828' : 
                             goal.achievementRate <= 70 ? '#f57c00' : 
                             goal.achievementRate <= 90 ? '#2e7d32' : 
                             '#1976d2'
                    }}
                  >
                    {Array.from({ length: 11 }, (_, i) => i * 10).map(rate => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="goal-quadrant">
              <h3>第２象限</h3>
              {currentGoals.quadrant2.map((goal, idx) => (
                <div key={goal.id} className="goal-item">
                  <div className="goal-number">{idx === 0 ? '➀' : idx === 1 ? '②' : '➂'}</div>
                  <input
                    type="text"
                    value={goal.text}
                    onChange={(e) => handleGoalUpdate('quadrant2', idx, 'text', e.target.value)}
                    placeholder="目標を入力..."
                    className="goal-input"
                  />
                  <select
                    value={goal.achievementRate}
                    onChange={(e) => handleGoalUpdate('quadrant2', idx, 'achievementRate', parseInt(e.target.value))}
                    className="goal-rate-select"
                    style={{
                      backgroundColor: goal.achievementRate <= 50 ? '#ffebee' : 
                                      goal.achievementRate <= 70 ? '#fff9e6' : 
                                      goal.achievementRate <= 90 ? '#e8f5e9' : 
                                      '#e3f2fd',
                      color: goal.achievementRate <= 50 ? '#c62828' : 
                             goal.achievementRate <= 70 ? '#f57c00' : 
                             goal.achievementRate <= 90 ? '#2e7d32' : 
                             '#1976d2'
                    }}
                  >
                    {Array.from({ length: 11 }, (_, i) => i * 10).map(rate => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div className="goals-copy-section">
            <button onClick={handleCopyGoals} className="goals-button-small">
              最重要目標をクリップボードにコピー
            </button>
          </div>
        </div>

        {/* ポモドーロタイマー */}
        <div className={`pomodoro-section ${isBreak ? 'break-mode' : ''}`}>
          <div className="pomodoro-icon">⏱</div>
          <div className="pomodoro-content">
            <div className="pomodoro-time">
              {Math.floor(pomodoroTime / 60).toString().padStart(2, '0')}:
              {(pomodoroTime % 60).toString().padStart(2, '0')}
            </div>
            <div className="pomodoro-controls">
              <button onClick={handlePomodoroToggle} className="pomodoro-toggle-button">
                {isPomodoroRunning ? '⏸' : '▶'}
              </button>
              <button onClick={handlePomodoroReset} className="pomodoro-reset-button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* メインコンテンツ：タスク一覧とタイムライン */}
        <div className="main-content">
          {/* タスク一覧（時間軸表示） */}
          <div className="tasks-section">
            <div className="tasks-header">
              <h2>タスク一覧（スケジュール）</h2>
              <button 
                onClick={async () => {
                  const tasks = tasksByDate[getDateKey(selectedDate)] || []
                  if (tasks.length === 0) {
                    alert('クリアするタスクがありません。')
                    return
                  }
                  if (window.confirm('選択した日付のタスク一覧をすべてクリアしますか？')) {
                    const selectedDateKey = getDateKey(selectedDate)
                    setTasksByDate(prevTasksByDate => {
                      const updated = { ...prevTasksByDate }
                      updated[selectedDateKey] = []
                      return updated
                    })
                    setTasks([])
                    
                    // 実行中のタスクがある場合は停止
                    if (activeTaskId) {
                      setActiveTaskId(null)
                      startTimeRef.current = null
                    }
                    
                    // Firestoreに保存
                    if (user) {
                      try {
                        const todayKey = getDateKey(new Date())
                        const updatedTasksByDate = { ...tasksByDate }
                        updatedTasksByDate[selectedDateKey] = []
                        await saveUserData(user.uid, {
                          tasks: [],
                          tasksByDate: updatedTasksByDate,
                          goalsByDate,
                          tasksDate: todayKey
                        })
                      } catch (error) {
                        console.error('タスク一覧のクリア保存に失敗:', error)
                      }
                    }
                  }
                }}
                className="tasks-clear-button"
              >
                クリア
              </button>
            </div>
            
            {(() => {
              const tasks = tasksByDate[getDateKey(selectedDate)] || []
              const selectedDateStart = new Date(selectedDate)
              selectedDateStart.setHours(0, 0, 0, 0)
              
              // 表示する時間範囲を決定（7時から22時）
              const minHour = 7
              const maxHour = 22
              const hours: number[] = []
              for (let h = minHour; h <= maxHour; h++) {
                hours.push(h)
              }
              
              // 予定タスクを収集（重複を防ぐためにMapを使用）
              const scheduledTasksMap = new Map<string, {
                taskId: string
                taskName: string
                taskColor: string
                start: number
                end: number
                estimatedTime: number
                actualTime: number // 実績時間
              }>()
              
              tasks.forEach(task => {
                if (task.estimatedTime && task.scheduledStart && task.scheduledEnd) {
                  // Google Calendarから取得した予定時間を使用
                  // 選択した日付の範囲に合わせる
                  const taskStartDate = new Date(task.scheduledStart)
                  
                  // 選択した日付とタスクの日付が一致するか確認
                  // タイムゾーンの問題を避けるため、ローカルタイムで日付を比較
                  const taskDateKey = getDateKey(taskStartDate)
                  const selectedDateKey = getDateKey(selectedDate)
                  
                  
                  if (taskDateKey === selectedDateKey) {
                    // 重複を防ぐためにtaskIdをキーとして使用
                    if (!scheduledTasksMap.has(task.id)) {
                      // 実績時間を計算
                      const actualTime = task.sessions.reduce((sum, session) => {
                        if (session.end) {
                          return sum + (session.end - session.start)
                        } else if (activeTaskId === task.id) {
                          return sum + (Date.now() - session.start)
                        }
                        return sum
                      }, 0)
                      
                      scheduledTasksMap.set(task.id, {
                        taskId: task.id,
                        taskName: task.name,
                        taskColor: task.color,
                        start: task.scheduledStart,
                        end: task.scheduledEnd,
                        estimatedTime: task.estimatedTime,
                        actualTime: actualTime
                      })
                    }
                  }
                } else if (task.estimatedTime) {
                  // estimatedTimeはあるが、scheduledStart/scheduledEndがない場合（後方互換性）
                  // タスクの最初のセッションの開始時間を使用、なければ9:00をデフォルト
                  const firstSession = task.sessions.find(s => s.start)
                  const startHour = firstSession ? new Date(firstSession.start).getHours() : 9
                  const startMinute = firstSession ? new Date(firstSession.start).getMinutes() : 0
                  const scheduledStart = new Date(selectedDate)
                  scheduledStart.setHours(startHour, startMinute, 0, 0)
                  const scheduledEnd = new Date(scheduledStart.getTime() + task.estimatedTime)
                  
                  // 重複を防ぐためにtaskIdをキーとして使用
                  if (!scheduledTasksMap.has(task.id)) {
                    // 実績時間を計算
                    const actualTime = task.sessions.reduce((sum, session) => {
                      if (session.end) {
                        return sum + (session.end - session.start)
                      } else if (activeTaskId === task.id) {
                        return sum + (Date.now() - session.start)
                      }
                      return sum
                    }, 0)
                    
                    scheduledTasksMap.set(task.id, {
                      taskId: task.id,
                      taskName: task.name,
                      taskColor: task.color,
                      start: scheduledStart.getTime(),
                      end: scheduledEnd.getTime(),
                      estimatedTime: task.estimatedTime,
                      actualTime: actualTime
                    })
                  }
                }
              })
              
              const scheduledTasks = Array.from(scheduledTasksMap.values())
              
              // カレンダーからのタスク（scheduledStartがあるタスク）がない場合は時間軸を表示しない
              if (scheduledTasks.length === 0) {
                return null
              }
              
              // グローバルにカラムを割り当てる（すべてのタスクに対して）
              // タスクを開始時間でソート
              const allTasksSorted = [...scheduledTasks].sort((a, b) => a.start - b.start)
              
              // 3カラム固定で表示
              const columnCount = 3
              
              // 時間的な重複を考慮してカラムを割り当てる
              const globalColumnAssignments = new Map<string, number>() // taskId -> columnIndex
              const columnTasks: Array<Array<typeof allTasksSorted[0]>> = [[], [], []] // 各カラムのタスク
              
              for (const task of allTasksSorted) {
                let assignedColumn = -1
                
                // 各カラムを順番にチェック（0=1カラム目、1=2カラム目、2=3カラム目）
                for (let colIdx = 0; colIdx < 3; colIdx++) {
                  const tasksInColumn = columnTasks[colIdx]
                  let hasOverlap = false
                  
                  // このカラム内のすべてのタスクと重複をチェック
                  for (const existingTask of tasksInColumn) {
                    if (task.start < existingTask.end && task.end > existingTask.start) {
                      hasOverlap = true
                      break
                    }
                  }
                  
                  if (!hasOverlap) {
                    assignedColumn = colIdx
                    tasksInColumn.push(task)
                    break
                  }
                }
                
                // すべてのカラムで重複している場合、1カラム目に強制的に配置
                if (assignedColumn === -1) {
                  assignedColumn = 0
                  columnTasks[0].push(task)
                }
                
                globalColumnAssignments.set(task.taskId, assignedColumn)
              }
              
              // 現在時刻ライン用の計算
              const now = currentTime
              const nowHour = now.getHours()
              const nowMinute = now.getMinutes()
              const isToday = selectedDate.toDateString() === new Date().toDateString()
              const showCurrentTimeLine = isToday && nowHour >= minHour && nowHour <= maxHour
              // タイムライン全体の中での位置を計算（ピクセル単位）
              const slotHeight = 120 // 各時間スロットの高さ
              const currentTimePosition = showCurrentTimeLine 
                ? ((nowHour - minHour) * slotHeight) + ((nowMinute / 60) * slotHeight)
                : 0
              
              return (
                <div 
                  className="schedule-timeline"
                  ref={tasksTimelineRef}
                  onScroll={handleTasksTimelineScroll}
                >
                  {/* 現在時刻ライン */}
                  {showCurrentTimeLine && (
                    <div 
                      className="current-time-line"
                      style={{ top: `${currentTimePosition}px` }}
                    >
                      <span className="current-time-label">{nowHour}:{nowMinute.toString().padStart(2, '0')}</span>
                    </div>
                  )}
                  {hours.map(hour => {
                    // この時間帯の開始・終了時刻を計算
                    const hourStart = new Date(selectedDate)
                    hourStart.setHours(hour, 0, 0, 0)
                    const hourStartTime = hourStart.getTime()
                    
                    // この時間帯に関連するタスクをフィルタリング
                    // タスクの開始時間がこの時間帯内にあるタスクのみを表示
                    const relevantTasks = scheduledTasks.filter(task => {
                      const taskStartDate = new Date(task.start)
                      const taskDateKey = getDateKey(taskStartDate)
                      const selectedDateKey = getDateKey(selectedDate)
                      if (taskDateKey !== selectedDateKey) {
                        return false
                      }
                      
                      const taskStartHour = taskStartDate.getHours()
                      return taskStartHour === hour
                    })
                    
                    // タスクを開始時間でソート
                    const sortedTasks = [...relevantTasks].sort((a, b) => a.start - b.start)
                    
                    return (
                      <div key={hour} className="schedule-time-slot">
                        <div className="schedule-time-label">
                          {hour}時
                        </div>
                        <div className="schedule-time-line"></div>
                        <div 
                          className="schedule-tasks-container"
                          style={{ 
                            position: 'relative'
                          }}
                        >
                          {/* 15分、30分、45分のグリッドライン */}
                          <div className="grid-line grid-line-15"></div>
                          <div className="grid-line grid-line-30"></div>
                          <div className="grid-line grid-line-45"></div>
                          {sortedTasks.map((task, taskIdx) => {
                            const taskStartTime = task.start
                            const taskEndTime = task.end
                            
                            // グローバルに割り当てられたカラムを取得
                            const columnIndex = globalColumnAssignments.get(task.taskId) || 0
                            
                            // タスクの開始位置を計算（この時間帯内での分単位）
                            const taskStartInSlot = (taskStartTime - hourStartTime) / (1000 * 60) // 分単位
                            
                            // この時間帯内での開始位置（0-60分の範囲）
                            const validStartInSlot = Math.max(0, Math.min(60, taskStartInSlot))
                            
                            // タスクの全期間を表示（複数の時間帯にまたがる場合も1つのブロックで表示）
                            const taskDurationMinutes = (taskEndTime - taskStartTime) / (1000 * 60) // 分単位
                            
                            // タスクの高さ（60分を超える場合も許容）
                            const heightInSlot = taskDurationMinutes
                            
                            // カラム位置を計算（最大3カラムで横に並べる）
                            const gapPercent = 1.5 // カラム間のgap（%）
                            const slotWidth = 100 // 時間帯の幅（%）
                            const totalGapWidth = gapPercent * (columnCount - 1)
                            const taskWidthPercent = (slotWidth - totalGapWidth) / columnCount
                            // カラム間のgapを考慮して左側のオフセットを計算
                            const leftOffsetPercent = columnIndex * (taskWidthPercent + gapPercent)
                            
                            // topを計算（この時間帯内での開始位置を60分に対する割合で）
                            // marginTopのパーセントは親要素の「幅」に対して計算されるため、topを使用
                            const topPercent = (validStartInSlot / 60) * 100
                            const heightPercent = (heightInSlot / 60) * 100
                            
                            const isActive = activeTaskId === task.taskId
                            
                            return (
                              <div
                                key={`${task.taskId}-${hour}-${taskIdx}`}
                                className={`schedule-task-block scheduled ${isActive ? 'active' : ''}`}
                                style={{
                                  borderLeftColor: task.taskColor,
                                  left: `${leftOffsetPercent}%`,
                                  width: `${taskWidthPercent}%`,
                                  top: `${topPercent}%`,
                                  height: `${heightPercent}%`,
                                  minHeight: '40px'
                                }}
                                onClick={() => handleTaskToggle(task.taskId)}
                              >
                                <div className="schedule-task-content">
                                  <div className="schedule-task-time">
                                    {formatDateTime(taskStartTime)} ～ {formatDateTime(taskEndTime)}
                                  </div>
                                  <div className="schedule-task-name">{task.taskName}</div>
                                  {task.actualTime > 0 && (
                                    <div className="schedule-task-actual">
                                      実績: {formatTime(task.actualTime)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        {/* 30分の区切り線 */}
                        {hour < maxHour && (
                          <div className="schedule-half-hour-line"></div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
            
            {/* タスク追加フォーム */}
            <div className="add-task-section">
              {/* 手動追加したタスク一覧 */}
              {(() => {
                const currentTasks = tasksByDate[getDateKey(selectedDate)] || []
                const manualTasks = currentTasks.filter(task => !task.scheduledStart)
                if (manualTasks.length === 0) return null
                return (
                  <div className="manual-tasks-list">
                    {manualTasks.map(task => {
                      const isActive = activeTaskId === task.id
                      // 実行中の場合、現在の経過時間を計算
                      let currentDuration = task.totalTime
                      if (isActive && startTimeRef.current) {
                        currentDuration = task.totalTime + (Date.now() - startTimeRef.current)
                      }
                      return (
                        <div
                          key={task.id}
                          className={`manual-task-item ${isActive ? 'active' : ''}`}
                          style={{ borderLeftColor: task.color }}
                          onClick={() => handleTaskToggle(task.id)}
                        >
                          <button 
                            className="manual-task-delete-btn"
                            onClick={(e) => handleDeleteTask(task.id, e)}
                            title="削除"
                          >
                            ×
                          </button>
                          <span className="manual-task-name">{task.name}</span>
                          {currentDuration > 0 && (
                            <span className="manual-task-time">実績: {formatTime(currentDuration)}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
              <div className="add-task-input-row">
                <input
                  type="text"
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddTask()}
                  placeholder="新しいタスクを入力..."
                  className="task-input"
                />
                <button onClick={handleAddTask} className="add-button">
                  追加
                </button>
              </div>
              <div className="color-picker">
                {TASK_COLORS.map(color => (
                  <button
                    key={color}
                    className={`color-option ${selectedColor === color ? 'selected' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setSelectedColor(color)}
                    title={color}
                  />
                ))}
              </div>
            </div>
            
            {/* Googleカレンダー連携 */}
            <div className="calendar-section">
              <h2>Googleカレンダー連携</h2>
              {isGoogleCalendarConnected ? (
                <div className="calendar-connected">
                  <span className="calendar-status">✓ 連携済み</span>
                  <button 
                    onClick={async () => {
                      console.log('🟡🟡🟡 タスク取得ボタンがクリックされました 🟡🟡🟡')
                      console.log('[DEBUG] Fetch button clicked (連携済み)')
                      console.log('[DEBUG] 選択中の日付:', getDateKey(selectedDate))
                      try {
                        await fetchTasksFromGoogleCalendar(selectedDate)
                        console.log('[DEBUG] fetchTasksFromGoogleCalendar completed successfully')
                      } catch (error: any) {
                        console.error('[DEBUG] Error in fetch button:', error)
                        alert(`エラー: ${error.message || '不明なエラー'}`)
                      }
                    }} 
                    className="calendar-fetch-button"
                  >
                    タスクを取得
                  </button>
                  <button 
                    onClick={() => {
                      localStorage.removeItem('google_access_token')
                      setIsGoogleCalendarConnected(false)
                      alert('連携を解除しました。')
                    }} 
                    className="calendar-disconnect-button"
                  >
                    連携解除
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '10px', lineHeight: '1.5' }}>
                    Googleカレンダーから今日のイベントをタスクとして取得できます。<br />
                    初回のみ、Googleアカウントへのアクセス許可が必要です。
                  </p>
                  <button 
                    onClick={async () => {
                      // 確実にログが表示されるように、複数の方法で出力
                      console.log('🟢🟢🟢 ボタンがクリックされました 🟢🟢🟢')
                      console.log('=== ボタンクリック開始 ===')
                      console.log('[DEBUG] Button clicked: Googleカレンダーからタスクを取得')
                      console.log('[DEBUG] User:', user ? { uid: user.uid, email: user.email } : 'null')
                      
                      // アクセストークンが取得できていない場合は、まずアクセストークンを要求
                      const token = localStorage.getItem('google_access_token')
                      console.log('[DEBUG] Current token:', token ? `exists (length: ${token.length})` : 'not found')
                      
                      if (!token) {
                        console.log('[DEBUG] No token, starting OAuth flow')
                        // Google Calendar API用のアクセストークンを取得するために認証が必要
                        const clientId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string) || ''
                        console.log('[DEBUG] Client ID:', clientId ? 'exists' : 'not found')
                        if (!clientId) {
                          alert('Google Client IDが設定されていません。')
                          return
                        }
                        const redirectUri = window.location.origin
                        const scope = 'https://www.googleapis.com/auth/calendar.readonly'
                        // 既にFirebaseでログインしている場合、prompt=select_accountを使用（アカウント選択のみ）
                        // 初回のみ同意画面が表示される
                        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}&prompt=select_account`
                        console.log('[DEBUG] Redirecting to OAuth flow:', authUrl)
                        window.location.href = authUrl
                        return
                      }
                      
                      // アクセストークンが取得できている場合は、直接タスクを取得
                      console.log('[DEBUG] Token exists, calling fetchTasksFromGoogleCalendar')
                      console.log('[DEBUG] 選択中の日付:', getDateKey(selectedDate))
                      try {
                        await fetchTasksFromGoogleCalendar(selectedDate)
                        console.log('[DEBUG] fetchTasksFromGoogleCalendar completed')
                      } catch (error: any) {
                        console.error('[DEBUG] Failed to fetch tasks:', error)
                        console.error('[DEBUG] Error message:', error.message)
                        console.error('[DEBUG] Error stack:', error.stack)
                        alert(`タスクの取得に失敗しました: ${error.message || '不明なエラー'}\n\nブラウザのコンソール（F12キー）で詳細を確認してください。`)
                      }
                      console.log('=== ボタンクリック終了 ===')
                    }}
                    className="calendar-connect-button"
                  >
                    Googleカレンダーからタスクを取得
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 実績カラム */}
          <div className="timeline-section">
            <div className="timeline-header">
              <h2>実績</h2>
              <button onClick={handleResetToday} className="timeline-clear-button">
                クリア
              </button>
            </div>
            {(() => {
              const allSessions = getSelectedDateData()
              const sortedSessions = [...allSessions].sort((a, b) => a.start - b.start)
              
              // 表示する時間範囲を決定（7時から22時）
              const minHour = 7
              const maxHour = 22
              const executionHours: number[] = []
              for (let h = minHour; h <= maxHour; h++) {
                executionHours.push(h)
              }
              
              // 現在時刻ライン用の計算（実行時間カラム）
              const nowExec = currentTime
              const nowHourExec = nowExec.getHours()
              const nowMinuteExec = nowExec.getMinutes()
              const isTodayExec = selectedDate.toDateString() === new Date().toDateString()
              const minHourExec = 7
              const maxHourExec = 22
              const showCurrentTimeLineExec = isTodayExec && nowHourExec >= minHourExec && nowHourExec <= maxHourExec
              const slotHeightExec = 120
              const currentTimePositionExec = showCurrentTimeLineExec 
                ? ((nowHourExec - minHourExec) * slotHeightExec) + ((nowMinuteExec / 60) * slotHeightExec)
                : 0
              
              return (
                <div 
                  className="schedule-timeline"
                  ref={executionTimelineRef}
                  onScroll={handleExecutionTimelineScroll}
                >
                  {/* 現在時刻ライン */}
                  {showCurrentTimeLineExec && (
                    <div 
                      className="current-time-line"
                      style={{ top: `${currentTimePositionExec}px` }}
                    >
                      <span className="current-time-label">{nowHourExec}:{nowMinuteExec.toString().padStart(2, '0')}</span>
                    </div>
                  )}
                  {executionHours.map(hour => {
                    const sessionsInHour = sortedSessions.filter(session => {
                      const sessionStartHour = new Date(session.start).getHours()
                      return sessionStartHour === hour
                    })
                    
                    return (
                      <div key={hour} className="schedule-time-slot">
                        <div className="schedule-time-label">{hour}時</div>
                        <div className="schedule-tasks-container execution-container">
                          {/* 15分、30分、45分のグリッドライン */}
                          <div className="grid-line grid-line-15"></div>
                          <div className="grid-line grid-line-30"></div>
                          <div className="grid-line grid-line-45"></div>
                          {sessionsInHour.map((session, idx) => {
                            const duration = session.end - session.start
                            const durationMinutes = duration / (1000 * 60)
                            const sessionStartDate = new Date(session.start)
                            const startMinute = sessionStartDate.getMinutes()
                            const topPercent = (startMinute / 60) * 100
                            const heightPercent = Math.max((durationMinutes / 60) * 100, 25) // 最小25%
                            
                            const isEditing = editingSession?.taskId === session.taskId && editingSession?.sessionIndex === session.sessionIndex
                            
                            return (
                              <div
                                key={`${session.taskId}-${session.sessionIndex}-${idx}`}
                                className={`execution-item ${session.isActive ? 'active' : ''} ${isEditing ? 'editing' : ''}`}
                                style={{ 
                                  borderLeftColor: session.taskColor,
                                  position: 'absolute',
                                  top: `${topPercent}%`,
                                  left: 0,
                                  right: 0,
                                  height: isEditing ? 'auto' : `${heightPercent}%`,
                                  minHeight: '40px',
                                  zIndex: isEditing ? 10 : 1,
                                }}
                              >
                                {isEditing ? (
                                  <div className="execution-edit-form">
                                    <div className="execution-edit-row">
                                      <input
                                        type="time"
                                        value={editingSession.startTime}
                                        onChange={(e) => setEditingSession({ ...editingSession, startTime: e.target.value })}
                                        className="execution-time-input"
                                      />
                                      <span>～</span>
                                      <input
                                        type="time"
                                        value={editingSession.endTime}
                                        onChange={(e) => setEditingSession({ ...editingSession, endTime: e.target.value })}
                                        className="execution-time-input"
                                      />
                                    </div>
                                    <div className="execution-edit-name">{session.taskName}</div>
                                    <div className="execution-edit-buttons">
                                      <button onClick={handleSaveSession} className="execution-save-btn">保存</button>
                                      <button onClick={() => setEditingSession(null)} className="execution-cancel-btn">キャンセル</button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <button 
                                      className="execution-delete-btn"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteSession(session.taskId, session.sessionIndex)
                                      }}
                                      title="削除"
                                    >
                                      ×
                                    </button>
                                    <span 
                                      className="execution-time clickable"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEditSession(session.taskId, session.sessionIndex, session.start, session.end)
                                      }}
                                    >
                                      {formatDateTime(session.start)} ～ {formatDateTime(session.end)}
                                    </span>
                                    <span className="execution-name">{session.taskName}</span>
                                    <span className="execution-duration">{formatTime(duration)}</span>
                                  </>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
            {/* 実績時間をクリップボードにコピー（スクロール外） */}
            <div className="timeline-copy-section">
              <button onClick={handleCopyReport} className="report-button">
                実績をクリップボードにコピー
              </button>
                      {/* 円グラフで実績時間を表示 */}
                      {(() => {
                        // 選択された日付の各タスクの実績時間を集計
                        const selectedDateStart = new Date(selectedDate)
                        selectedDateStart.setHours(0, 0, 0, 0)
                        const selectedDateEnd = new Date(selectedDate)
                        selectedDateEnd.setHours(23, 59, 59, 999)
                        const selectedDateStartTime = selectedDateStart.getTime()
                        const selectedDateEndTime = selectedDateEnd.getTime()
                        
                        const taskTimes: Array<{ name: string; time: number; color: string }> = []
                        const currentTasks = tasksByDate[getDateKey(selectedDate)] || []
                        
                        currentTasks.forEach(task => {
                          const dateSessions = task.sessions.filter(session => {
                            if (session.end) {
                              return session.end >= selectedDateStartTime && session.start <= selectedDateEndTime
                            }
                            return selectedDate.toDateString() === new Date().toDateString() && 
                                   session.start >= selectedDateStartTime && 
                                   activeTaskId === task.id
                          })
                          
                          const dateTime = dateSessions.reduce((sum, session) => {
                            if (session.end) {
                              const sessionStart = Math.max(session.start, selectedDateStartTime)
                              const sessionEnd = Math.min(session.end, selectedDateEndTime)
                              if (sessionStart < sessionEnd) {
                                return sum + (sessionEnd - sessionStart)
                              }
                            } else if (activeTaskId === task.id && selectedDate.toDateString() === new Date().toDateString()) {
                              const sessionStart = session.start
                              const sessionEnd = Date.now()
                              return sum + (sessionEnd - sessionStart)
                            }
                            return sum
                          }, 0)
                          
                          if (dateTime > 0) {
                            taskTimes.push({
                              name: task.name,
                              time: dateTime,
                              color: task.color
                            })
                          }
                        })
                        
                        if (taskTimes.length === 0) {
                          return null
                        }
                        
                        const totalTime = taskTimes.reduce((sum, item) => sum + item.time, 0)
                        if (totalTime === 0) {
                          return null
                        }
                        
                        // 円グラフを描画
                        const radius = 100
                        const centerX = 150
                        const centerY = 150
                        let currentAngle = -90 // 開始角度（上から）
                        
                        const paths = taskTimes.map((item) => {
                          const percentage = (item.time / totalTime) * 100
                          const angle = (item.time / totalTime) * 360
                          const startAngle = currentAngle
                          const endAngle = currentAngle + angle
                          
                          const startAngleRad = (startAngle * Math.PI) / 180
                          const endAngleRad = (endAngle * Math.PI) / 180
                          
                          const x1 = centerX + radius * Math.cos(startAngleRad)
                          const y1 = centerY + radius * Math.sin(startAngleRad)
                          const x2 = centerX + radius * Math.cos(endAngleRad)
                          const y2 = centerY + radius * Math.sin(endAngleRad)
                          
                          const largeArcFlag = angle > 180 ? 1 : 0
                          
                          const pathData = [
                            `M ${centerX} ${centerY}`,
                            `L ${x1} ${y1}`,
                            `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
                            'Z'
                          ].join(' ')
                          
                          currentAngle = endAngle
                          
                          return {
                            path: pathData,
                            color: item.color,
                            name: item.name,
                            time: item.time,
                            percentage: percentage
                          }
                        })
                        
                        return (
                          <div className="pie-chart-section">
                            <h3>実績時間の内訳</h3>
                            <div className="pie-chart-container">
                              <svg width="300" height="300" viewBox="0 0 300 300" className="pie-chart-svg">
                                {paths.map((item) => (
                                  <path
                                    key={item.name}
                                    d={item.path}
                                    fill={item.color}
                                    stroke="#fff"
                                    strokeWidth="2"
                                  />
                                ))}
                              </svg>
                              <div className="pie-chart-legend">
                                {paths.map((item) => (
                                  <div key={item.name} className="pie-chart-legend-item">
                                    <div 
                                      className="pie-chart-legend-color" 
                                      style={{ backgroundColor: item.color }}
                                    />
                                    <div className="pie-chart-legend-text">
                                      <div className="pie-chart-legend-name">{item.name}</div>
                                      <div className="pie-chart-legend-time">
                                        {formatTime(item.time)} ({item.percentage.toFixed(1)}%)
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )
                      })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

import { useState, useEffect, useRef } from 'react'
import './App.css'

interface Task {
  id: string
  name: string
  totalTime: number // ミリ秒
  sessions: Array<{ start: number; end?: number }> // セッション履歴
  color: string // タスクの色
  order: number // 並び順
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

const STORAGE_KEY = 'tasklog-tasks'
const GOALS_STORAGE_KEY = 'tasklog-goals'

// 日付をキーに変換（YYYY-MM-DD形式）
const getDateKey = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function App() {
  // ローカルストレージからタスクを読み込む
  const loadTasksFromStorage = (): Task[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.error('Failed to load tasks from storage:', error)
    }
    return []
  }

  // 目標を読み込む（日付ごと）
  const loadGoalsFromStorage = (): GoalsByDate => {
    try {
      const stored = localStorage.getItem(GOALS_STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.error('Failed to load goals from storage:', error)
    }
    return {}
  }

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

  const [tasks, setTasks] = useState<Task[]>(loadTasksFromStorage)
  const [goalsByDate, setGoalsByDate] = useState<GoalsByDate>(loadGoalsFromStorage)
  const [newTaskName, setNewTaskName] = useState('')
  const [selectedColor, setSelectedColor] = useState(TASK_COLORS[0])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [isGoogleCalendarConnected, setIsGoogleCalendarConnected] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date()) // 履歴表示用の日付
  const [editingSession, setEditingSession] = useState<{ taskId: string; sessionIndex: number } | null>(null)
  const [editStartTime, setEditStartTime] = useState('')
  const [editEndTime, setEditEndTime] = useState('')
  const intervalRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  
  // ポモドーロタイマー
  const [pomodoroTime, setPomodoroTime] = useState(25 * 60) // 25分を秒で
  const [isPomodoroRunning, setIsPomodoroRunning] = useState(false)
  const [isBreak, setIsBreak] = useState(false) // true = 休憩時間, false = 作業時間
  const pomodoroIntervalRef = useRef<number | null>(null)

  // タスクをローカルストレージに保存
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
    } catch (error) {
      console.error('Failed to save tasks to storage:', error)
    }
  }, [tasks])

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

  // ストップウォッチの更新（UI更新用）
  useEffect(() => {
    if (activeTaskId && startTimeRef.current) {
      intervalRef.current = window.setInterval(() => {
        // UI更新のためのインターバル（必要に応じて使用）
      }, 1000)
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
  }, [activeTaskId])

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
      setTasks(prevTasks => [
        newTask,
        ...prevTasks.map(task => ({ ...task, order: task.order + 1 }))
      ])
      setNewTaskName('')
    }
  }

  // ドラッグ&ドロップ
  const handleDragStart = (taskId: string) => {
    setDraggedTaskId(taskId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (targetTaskId: string) => {
    if (!draggedTaskId || draggedTaskId === targetTaskId) return

    setTasks(prevTasks => {
      const draggedTask = prevTasks.find(t => t.id === draggedTaskId)
      const targetTask = prevTasks.find(t => t.id === targetTaskId)
      if (!draggedTask || !targetTask) return prevTasks

      const newTasks = prevTasks.filter(t => t.id !== draggedTaskId)
      const targetIndex = newTasks.findIndex(t => t.id === targetTaskId)
      
      newTasks.splice(targetIndex, 0, draggedTask)
      
      // orderを更新
      return newTasks.map((task, index) => ({
        ...task,
        order: index
      }))
    })
    
    setDraggedTaskId(null)
  }

  // タスク選択/停止
  const handleTaskToggle = (taskId: string) => {
    if (activeTaskId === taskId) {
      // 停止
      if (startTimeRef.current) {
        const now = Date.now()
        setTasks(prevTasks => {
          return prevTasks.map(task => {
            if (task.id === taskId) {
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
        })
      }
      setActiveTaskId(null)
      startTimeRef.current = null
    } else {
      // 他のタスクが実行中なら停止
      if (activeTaskId && startTimeRef.current) {
        const now = Date.now()
        setTasks(prevTasks => {
          return prevTasks.map(task => {
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
        })
      }
      
      // 新しいタスクを開始
      const now = Date.now()
      startTimeRef.current = now
      setActiveTaskId(taskId)
      setTasks(prevTasks => {
        return prevTasks.map(task => {
          if (task.id === taskId) {
            return {
              ...task,
              sessions: [...task.sessions, { start: now }]
            }
          }
          return task
        })
      })
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
  const handleResetToday = () => {
    if (window.confirm('本日のデータをリセットしますか？この操作は取り消せません。')) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayStart = today.getTime()
      
      setTasks(tasks.map(task => {
        // 本日のセッションを除外
        const filteredSessions = task.sessions.filter(session => {
          if (session.end) {
            return session.end < todayStart
          }
          return session.start < todayStart || activeTaskId !== task.id
        })
        
        // 本日の時間を再計算
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
      }))
      
      // アクティブなタスクも停止
      if (activeTaskId) {
        setActiveTaskId(null)
        startTimeRef.current = null
      }
      
      alert('本日のデータをリセットしました。')
    }
  }

  // Googleカレンダーからタスクを取得
  const fetchTasksFromGoogleCalendar = async () => {
    try {
      const token = localStorage.getItem('google_access_token')
      if (!token) {
        alert('Googleカレンダーに接続してください。')
        setIsGoogleCalendarConnected(false)
        return
      }

      // 今日の日付範囲を設定
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayEnd = new Date(today)
      todayEnd.setHours(23, 59, 59, 999)
      
      const timeMin = today.toISOString()
      const timeMax = todayEnd.toISOString()

      // Google Calendar APIを使用してイベントを取得
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (response.status === 401) {
        // トークンが無効
        localStorage.removeItem('google_access_token')
        setIsGoogleCalendarConnected(false)
        alert('認証が期限切れです。再度連携してください。')
        return
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error?.message || `HTTP ${response.status}`)
      }
      
      const data = await response.json()
      
      if (!data.items || data.items.length === 0) {
        alert('今日のイベントはありません。')
        return
      }
      
      // 今日のイベントをタスクとして追加
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
        .map((event: any, index: number) => ({
          id: `calendar-${event.id}`,
          name: event.summary || '無題のイベント',
          totalTime: 0,
          sessions: [],
          color: TASK_COLORS[index % TASK_COLORS.length],
          order: tasks.length + index
        }))
      
      // 既存のタスクと統合（重複を避ける）
      setTasks(prevTasks => {
        const existingIds = new Set(prevTasks.map(t => t.id))
        const newTasks = calendarTasks.filter(t => !existingIds.has(t.id))
        if (newTasks.length > 0) {
          alert(`${newTasks.length}件のタスクを取得しました。`)
        } else {
          alert('新しいタスクはありません。')
        }
        return [...prevTasks, ...newTasks]
      })
    } catch (error: any) {
      console.error('Failed to fetch from Google Calendar:', error)
      if (error.message?.includes('401')) {
        localStorage.removeItem('google_access_token')
        setIsGoogleCalendarConnected(false)
        alert('認証が期限切れです。再度連携してください。')
      } else {
        alert(`Googleカレンダーからの取得に失敗しました: ${error.message || '不明なエラー'}`)
      }
    }
  }

  // Googleカレンダー認証
  const handleGoogleCalendarAuth = () => {
    // 環境変数から取得（Viteの場合はimport.meta.envを使用）
    const clientId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string) || ''
    if (!clientId) {
      alert('Google Client IDが設定されていません。\n\n設定方法:\n1. プロジェクトルートに.envファイルを作成\n2. VITE_GOOGLE_CLIENT_ID=your_client_id を追加\n3. 開発サーバーを再起動\n\nGoogle Cloud ConsoleでクライアントIDを取得してください。')
      return
    }
    const redirectUri = encodeURIComponent(window.location.origin)
    const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly')
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=${scope}&prompt=consent`
    
    window.location.href = authUrl
  }

  // OAuthコールバック処理
  useEffect(() => {
    const hash = window.location.hash
    
    // エラーチェック
    if (hash.includes('error=')) {
      const error = hash.split('error=')[1].split('&')[0]
      alert(`認証エラー: ${decodeURIComponent(error)}\n\nリダイレクトURIが正しく設定されているか確認してください。`)
      window.location.hash = ''
      return
    }
    
    // アクセストークンの取得
    if (hash.includes('access_token=')) {
      const token = hash.split('access_token=')[1].split('&')[0]
      const decodedToken = decodeURIComponent(token)
      localStorage.setItem('google_access_token', decodedToken)
      window.location.hash = ''
      setIsGoogleCalendarConnected(true)
      // 少し待ってから取得（状態が更新されるまで）
      setTimeout(() => {
        fetchTasksFromGoogleCalendar()
      }, 500)
    }
    
    // 既存のトークンをチェック
    const existingToken = localStorage.getItem('google_access_token')
    if (existingToken) {
      setIsGoogleCalendarConnected(true)
    }
  }, [])

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
  const handleDeleteTask = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation() // タスク選択のイベントを防ぐ
    if (window.confirm('このタスクを削除しますか？')) {
      setTasks(prevTasks => prevTasks.filter(task => task.id !== taskId))
      if (activeTaskId === taskId) {
        setActiveTaskId(null)
        startTimeRef.current = null
      }
    }
  }

  // セッション編集開始
  const handleStartEditSession = (taskId: string, sessionIndex: number, start: number, end: number, e?: React.MouseEvent | MouseEvent) => {
    if (e) {
      e.stopPropagation()
    }
    const startDate = new Date(start)
    const endDate = new Date(end)
    // 時間のみをHH:MM形式で保存
    const startTimeStr = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`
    const endTimeStr = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`
    setEditingSession({ taskId, sessionIndex })
    setEditStartTime(startTimeStr)
    setEditEndTime(endTimeStr)
  }

  // セッション編集保存
  const handleSaveEditSession = () => {
    if (!editingSession) return
    
    // 時間文字列（HH:MM）をパース
    const parseTime = (timeStr: string): { hours: number; minutes: number } | null => {
      const parts = timeStr.split(':')
      if (parts.length !== 2) return null
      const hours = parseInt(parts[0], 10)
      const minutes = parseInt(parts[1], 10)
      if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null
      }
      return { hours, minutes }
    }
    
    const startTime = parseTime(editStartTime)
    const endTime = parseTime(editEndTime)
    
    if (!startTime || !endTime) {
      alert('開始時刻と終了時刻を正しく入力してください（HH:MM形式）。')
      return
    }
    
    // 元のセッションの日付を取得
    const originalTask = tasks.find(t => t.id === editingSession.taskId)
    if (!originalTask) return
    
    const originalSession = originalTask.sessions[editingSession.sessionIndex]
    if (!originalSession || !originalSession.end) return
    
    const originalStartDate = new Date(originalSession.start)
    const originalEndDate = new Date(originalSession.end)
    
    // 日付は変更せず、時間のみを更新
    const newStartDate = new Date(originalStartDate)
    newStartDate.setHours(startTime.hours, startTime.minutes, 0, 0)
    
    const newEndDate = new Date(originalEndDate)
    newEndDate.setHours(endTime.hours, endTime.minutes, 0, 0)
    
    if (newStartDate.getTime() >= newEndDate.getTime()) {
      alert('開始時刻は終了時刻より前である必要があります。')
      return
    }
    
    setTasks(prevTasks => 
      prevTasks.map(task => {
        if (task.id === editingSession.taskId) {
          const newSessions = [...task.sessions]
          newSessions[editingSession.sessionIndex] = {
            start: newStartDate.getTime(),
            end: newEndDate.getTime()
          }
          return { ...task, sessions: newSessions }
        }
        return task
      })
    )
    
    setEditingSession(null)
    setEditStartTime('')
    setEditEndTime('')
  }

  // セッション編集キャンセル
  const handleCancelEditSession = () => {
    setEditingSession(null)
    setEditStartTime('')
    setEditEndTime('')
  }

  // セッション削除
  const handleDeleteSession = (taskId: string, sessionIndex: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm('この実行記録を削除しますか？')) {
      setTasks(prevTasks =>
        prevTasks.map(task => {
          if (task.id === taskId) {
            const newSessions = task.sessions.filter((_, idx) => idx !== sessionIndex)
            return { ...task, sessions: newSessions }
          }
          return task
        })
      )
    }
  }

  // 目標を更新
  const handleGoalUpdate = (quadrant: 'quadrant1' | 'quadrant2', index: number, field: 'text' | 'achievementRate', value: string | number) => {
    const dateKey = getDateKey(selectedDate)
    setGoalsByDate(prevGoalsByDate => {
      const newGoalsByDate = { ...prevGoalsByDate }
      const currentGoals = newGoalsByDate[dateKey] || createDefaultGoals()
      const newGoals = { ...currentGoals }
      const goal = { ...newGoals[quadrant][index] }
      
      if (field === 'text') {
        goal.text = value as string
      } else {
        goal.achievementRate = Math.max(0, Math.min(100, value as number))
      }
      
      newGoals[quadrant] = [...newGoals[quadrant]]
      newGoals[quadrant][index] = goal
      newGoalsByDate[dateKey] = newGoals
      
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

  return (
    <div className="app" style={{ backgroundColor: dayBackgroundColor, minHeight: '100vh' }}>
      <div className="container">
        <div className="header-section">
          <h1>TaskLog</h1>
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
                  <path d="M1 4V10H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M23 20V14H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* メインコンテンツ：タスク一覧とタイムライン */}
        <div className="main-content">
          {/* タスク一覧 */}
          <div className="tasks-section">
            <h2>タスク一覧</h2>
            
            {/* タスク追加フォーム */}
            <div className="add-task-section">
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
            {tasks.length === 0 ? (
              <p className="no-tasks">タスクがありません。上記から追加してください。</p>
            ) : (
              <div className="task-list">
                {tasks
                  .sort((a, b) => a.order - b.order)
                  .map(task => {
                  const isActive = activeTaskId === task.id
                  const selectedDateStart = new Date(selectedDate)
                  selectedDateStart.setHours(0, 0, 0, 0)
                  const selectedDateEnd = new Date(selectedDate)
                  selectedDateEnd.setHours(23, 59, 59, 999)
                  const selectedDateStartTime = selectedDateStart.getTime()
                  const selectedDateEndTime = selectedDateEnd.getTime()
                  
                  // 選択した日付のセッションを取得
                  const dateSessions = task.sessions.filter(session => {
                    if (session.end) {
                      return session.end >= selectedDateStartTime && session.start <= selectedDateEndTime
                    }
                    // 実行中のセッションは今日のみ
                    return selectedDate.toDateString() === new Date().toDateString() && 
                           session.start >= selectedDateStartTime && 
                           activeTaskId === task.id
                  })

                  // 選択した日付の合計時間を計算
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

                  return (
                    <div
                      key={task.id}
                      className={`task-item ${isActive ? 'active' : ''}`}
                      style={{ borderLeftColor: task.color }}
                      draggable
                      onDragStart={() => handleDragStart(task.id)}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDrop(task.id)}
                      onClick={() => handleTaskToggle(task.id)}
                    >
                      <button
                        onClick={(e) => handleDeleteTask(task.id, e)}
                        className="task-delete-button"
                        title="タスクを削除"
                      >
                        ×
                      </button>
                      <div className="task-name">{task.name}</div>
                      {dateTime > 0 && (
                        <div className="task-time">
                          {selectedDate.toDateString() === new Date().toDateString() ? '本日' : getDateString(selectedDate)}: {formatTime(dateTime)}
                        </div>
                      )}
                      <div className="task-status">
                        {isActive ? '⏸ 停止' : '▶ 開始'}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            
            {/* Googleカレンダー連携 */}
            <div className="calendar-section">
              <h2>Googleカレンダー連携</h2>
              {!isGoogleCalendarConnected ? (
                <div>
              <button onClick={handleGoogleCalendarAuth} className="calendar-connect-button">
                Googleカレンダーからタスクを取得
              </button>
                </div>
              ) : (
                <div className="calendar-connected">
                  <span className="calendar-status">✓ 連携済み</span>
                  <button 
                    onClick={fetchTasksFromGoogleCalendar} 
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
              )}
            </div>
          </div>

          {/* 実行時間カラム（時間軸） */}
          <div className="timeline-section">
            <div className="timeline-header">
              <h2>実行時間</h2>
              <button onClick={handleResetToday} className="timeline-clear-button">
                クリア
              </button>
            </div>
            {tasks.length === 0 ? (
              <p className="no-tasks">タスクがありません。</p>
            ) : (
              (() => {
                const allSessions = getSelectedDateData()
                
                if (allSessions.length === 0) {
                  return <p className="no-tasks">{getDateString(selectedDate)}の実行記録はありません。</p>
                }
                
                return (
                  <div className="timeline">
                    {allSessions.map((session, idx) => {
                      const duration = session.end - session.start
                      const isEditing = editingSession?.taskId === session.taskId && editingSession?.sessionIndex === session.sessionIndex
                      
                      return (
                        <div 
                          key={`${session.taskId}-${session.sessionIndex}-${idx}`} 
                          className={`timeline-item ${session.isActive ? 'active' : ''}`}
                          style={{ borderLeftColor: session.taskColor }}
                        >
                          {isEditing ? (
                            <div className="timeline-edit-form">
                              <div className="timeline-edit-inputs">
                                <div className="timeline-edit-input-group">
                                  <label>開始時刻</label>
                                  <input
                                    type="time"
                                    value={editStartTime}
                                    onChange={(e) => setEditStartTime(e.target.value)}
                                    className="timeline-edit-input"
                                  />
                                </div>
                                <div className="timeline-edit-input-group">
                                  <label>終了時刻</label>
                                  <input
                                    type="time"
                                    value={editEndTime}
                                    onChange={(e) => setEditEndTime(e.target.value)}
                                    className="timeline-edit-input"
                                  />
                                </div>
                              </div>
                              <div className="timeline-edit-actions">
                                <button onClick={handleSaveEditSession} className="timeline-edit-save">保存</button>
                                <button onClick={handleCancelEditSession} className="timeline-edit-cancel">キャンセル</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {!session.isActive && (
                                <button
                                  onClick={(e) => handleDeleteSession(session.taskId, session.sessionIndex, e)}
                                  className="timeline-delete-button"
                                  title="削除"
                                >
                                  ×
                                </button>
                              )}
                              <div 
                                className="timeline-content"
                                onClick={!session.isActive ? () => handleStartEditSession(session.taskId, session.sessionIndex, session.start, session.end, new MouseEvent('click')) : undefined}
                                style={{ cursor: !session.isActive ? 'pointer' : 'default' }}
                              >
                                <div className="timeline-time">
                                  {formatDateTime(session.start)} ～ {formatDateTime(session.end)}
                                  {session.isActive && ' [実行中]'}
                                </div>
                                <div className="timeline-task-name">{session.taskName}</div>
                                <div className="timeline-duration">{formatTime(duration)}</div>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                    {/* 実績時間をクリップボードにコピー */}
                    <div className="timeline-copy-section">
                      <button onClick={handleCopyReport} className="report-button">
                        実績をクリップボードにコピー
                      </button>
                    </div>
                  </div>
                )
              })()
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

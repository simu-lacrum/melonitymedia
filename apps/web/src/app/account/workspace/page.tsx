"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { LiveTerminal } from "@/components/ui/live-terminal"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Play, Users, Save, Loader2, CheckCircle, AlertCircle, Upload, X, Hash, Settings2, Image, Trash2, RefreshCw, Square, Monitor, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { toast } from "sonner"

interface Preset {
  id: string
  name: string
  config: Record<string, unknown>
}

type LaunchStatus = "idle" | "launching" | "success" | "error"

interface WarmupConfig {
  mode: "WARMUP"
  warmupMode: "DAYS" | "HOURS"
  concurrency: number
  warmupDays: number
  warmupHours: number
  useRotation: boolean
  headless: boolean
  hashtags: string[]
  comments: string[]
}

interface CookiesConfig {
  mode: "COOKIES"
  concurrency: number
  headless: boolean
}

interface EditProfileConfig {
  mode: "EDIT_PROFILE"
  concurrency: number
  headless: boolean
  bio: string
  nickname: string
  avatarUrl: string
}

interface UploadConfig {
  mode: "UPLOAD"
  concurrency: number
  headless: boolean
  videoId: string
  title: string
  description: string
  hashtags: string[]
  scheduleAt: string
  bannerId: string
}

const DEFAULT_CONFIGS = {
  WARMUP: {
    mode: "WARMUP", warmupMode: "DAYS", concurrency: 3, warmupDays: 10, warmupHours: 2, useRotation: true,
    headless: false, hashtags: [], comments: [],
  } as WarmupConfig,
  COOKIES: {
    mode: "COOKIES", concurrency: 5, headless: false,
  } as CookiesConfig,
  EDIT_PROFILE: {
    mode: "EDIT_PROFILE", concurrency: 3, headless: false,
    bio: "", nickname: "", avatarUrl: "",
  } as EditProfileConfig,
  UPLOAD: {
    mode: "UPLOAD", concurrency: 3, headless: false, videoId: "",
    title: "", description: "", hashtags: [], scheduleAt: "", bannerId: "",
  } as UploadConfig,
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? (
  process.env.NODE_ENV === "production" ? "" : "http://localhost:4000"
)

const parseWarmupComments = (value: string): string[] => {
  const seen = new Set<string>()
  const comments: string[] = []

  for (const line of value.split(/\r?\n/)) {
    const comment = line.replace(/\s+/g, " ").trim().slice(0, 240)
    if (!comment || seen.has(comment)) continue

    seen.add(comment)
    comments.push(comment)
    if (comments.length >= 50) break
  }

  return comments
}

interface VideoFile {
  id: string
  originalName: string
  filename: string
  size: number
  description?: string
  hashtags?: string[]
}

interface BannerFile {
  id: string
  originalName: string
  filename: string
  size: number
}

interface WorkspaceVncSession {
  id: string
  jobId: string
  accountId: string
  status: "ACTIVE" | "CLOSED"
  startedAt: string
  updatedAt: string
  monitorUrl: string
  accountLabel: string
  platform: "TIKTOK" | "YOUTUBE"
}

interface WorkspaceTask {
  id: string
  type: string
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"
  progress?: number
  error?: string | null
  cancelReason?: string | null
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  vncSessions?: WorkspaceVncSession[]
}

const TASK_TYPE_LABELS: Record<string, string> = {
  WARMUP: "Прогрев",
  COOKIES: "Куки",
  EDIT_PROFILE: "Профиль",
  UPLOAD: "Залив",
  LOGIN: "Логин",
  ANALYTICS_CRON: "Аналитика",
  SHADOWBAN_CHECK: "Shadowban check",
}

const TASK_STATUS_LABELS: Record<WorkspaceTask["status"], string> = {
  PENDING: "В очереди",
  RUNNING: "В работе",
  COMPLETED: "Готово",
  FAILED: "Ошибка",
  CANCELLED: "Отменена",
}

export default function WorkspacePage() {
  const [mode, setMode] = React.useState("WARMUP")
  const [launchStatus, setLaunchStatus] = React.useState<LaunchStatus>("idle")
  const [statusMsg, setStatusMsg] = React.useState("")
  const [presets, setPresets] = React.useState<Preset[]>([])
  const [selectedPresetId, setSelectedPresetId] = React.useState<string>("")
  const [accounts, setAccounts] = React.useState<{id: string; username: string; platform: string; status: string}[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = React.useState<Set<string>>(new Set())

  const [warmup, setWarmup] = React.useState<WarmupConfig>({ ...DEFAULT_CONFIGS.WARMUP })
  const [cookies, setCookies] = React.useState<CookiesConfig>({ ...DEFAULT_CONFIGS.COOKIES })
  const [editProfile, setEditProfile] = React.useState<EditProfileConfig>({ ...DEFAULT_CONFIGS.EDIT_PROFILE })
  const [upload, setUpload] = React.useState<UploadConfig>({ ...DEFAULT_CONFIGS.UPLOAD })

  const [hashtagInput, setHashtagInput] = React.useState("")
  const [warmupCommentText, setWarmupCommentText] = React.useState("")
  const [videos, setVideos] = React.useState<VideoFile[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [banners, setBanners] = React.useState<BannerFile[]>([])
  const [uploadingBanner, setUploadingBanner] = React.useState(false)
  const [uploadingAvatar, setUploadingAvatar] = React.useState(false)
  const [jobs, setJobs] = React.useState<WorkspaceTask[]>([])
  const [jobsLoading, setJobsLoading] = React.useState(false)
  const [cancellingTaskId, setCancellingTaskId] = React.useState<string | null>(null)
  const [selectedMonitor, setSelectedMonitor] = React.useState<{
    task: WorkspaceTask
    session: WorkspaceVncSession
  } | null>(null)

  const activeMonitors = React.useMemo(
    () => jobs.flatMap((task) =>
      (task.vncSessions || []).map((session) => ({ task, session })),
    ),
    [jobs],
  )

  const selectedMonitorIndex = React.useMemo(() => {
    if (!selectedMonitor) return -1
    return activeMonitors.findIndex(({ task, session }) =>
      task.id === selectedMonitor.task.id && session.id === selectedMonitor.session.id,
    )
  }, [activeMonitors, selectedMonitor])

  const openAdjacentMonitor = React.useCallback((direction: -1 | 1) => {
    if (selectedMonitorIndex === -1) return
    const next = activeMonitors[selectedMonitorIndex + direction]
    if (next) setSelectedMonitor(next)
  }, [activeMonitors, selectedMonitorIndex])

  const fetchJobs = React.useCallback(async () => {
    setJobsLoading(true)
    try {
      const data = await api.get<{
        tasks?: WorkspaceTask[]
        data?: {
          active?: WorkspaceTask[]
          waiting?: WorkspaceTask[]
          completed?: WorkspaceTask[]
          failed?: WorkspaceTask[]
        }
      }>("/api/workspace/jobs")

      if (Array.isArray(data.tasks)) {
        setJobs(data.tasks)
      } else {
        setJobs([
          ...(data.data?.active || []),
          ...(data.data?.waiting || []),
          ...(data.data?.failed || []),
          ...(data.data?.completed || []),
        ])
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Не удалось загрузить задачи")
    } finally {
      setJobsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    api.get<{ presets: Preset[] }>("/api/workspace/presets")
      .then((data) => { if (data.presets) setPresets(data.presets) })
      .catch(console.error)

    api.get<{ accounts: any[] }>("/api/accounts")
      .then((data) => {
        const accs = data.accounts || []
        setAccounts(accs)
        setSelectedAccountIds(new Set(accs.filter((a: any) => a.status === 'ALIVE').map((a: any) => a.id)))
      })
      .catch(() => {})

    fetchJobs()
  }, [fetchJobs])

  React.useEffect(() => {
    if (mode === "UPLOAD") {
      api.get<{ videos: VideoFile[] }>("/api/videos")
        .then((data) => setVideos(data.videos || []))
        .catch(() => {})
      api.get<{ banners: BannerFile[] }>("/api/workspace/banners")
        .then((data) => setBanners(data.banners || []))
        .catch(() => {})
    }
  }, [mode])

  const getActiveConfig = (): Record<string, unknown> => {
    switch (mode) {
      case "WARMUP": return { ...warmup }
      case "COOKIES": return { ...cookies }
      case "EDIT_PROFILE": return { ...editProfile }
      case "UPLOAD": return { ...upload }
      default: return {}
    }
  }

  const getConcurrency = (): number => {
    switch (mode) {
      case "WARMUP": return warmup.concurrency
      case "COOKIES": return cookies.concurrency
      case "EDIT_PROFILE": return editProfile.concurrency
      case "UPLOAD": return upload.concurrency
      default: return 3
    }
  }

  const handleSavePreset = async () => {
    const name = prompt("Введите имя пресета:")
    if (!name) return
    try {
      const config = getActiveConfig()
      const data = await api.post<{ preset: Preset }>("/api/workspace/presets", { name, config })
      setPresets([data.preset, ...presets])
      setSelectedPresetId(data.preset.id)
      toast.success("Пресет сохранён")
    } catch {
      toast.error("Ошибка сохранения пресета")
    }
  }

  const handleLoadPreset = (id: string) => {
    setSelectedPresetId(id)
    if (!id) return
    const preset = presets.find((p) => p.id === id)
    if (preset) {
      const cfg = preset.config as any
      const m = cfg.mode || mode
      setMode(m)
      switch (m) {
        case "WARMUP": {
          const comments = parseWarmupComments(Array.isArray(cfg.comments) ? cfg.comments.join("\n") : "")
          setWarmup({ ...DEFAULT_CONFIGS.WARMUP, ...cfg, comments })
          setWarmupCommentText(comments.join("\n"))
          break
        }
        case "COOKIES": setCookies({ ...DEFAULT_CONFIGS.COOKIES, ...cfg }); break
        case "EDIT_PROFILE": setEditProfile({ ...DEFAULT_CONFIGS.EDIT_PROFILE, ...cfg }); break
        case "UPLOAD": setUpload({ ...DEFAULT_CONFIGS.UPLOAD, ...cfg }); break
      }
      toast.success(`Пресет «${preset.name}» загружен`)
    }
  }

  const handleLaunch = async () => {
    if (selectedAccountIds.size === 0) {
      toast.error("Выберите хотя бы один аккаунт")
      return
    }
    // Upload-specific validations
    if (mode === "UPLOAD") {
      if (!upload.videoId) {
        toast.error("Загрузите и выберите видео для залива")
        return
      }
      if (!upload.title.trim()) {
        toast.error("Укажите заголовок видео")
        return
      }
    }
    setLaunchStatus("launching")
    setStatusMsg("")
    try {
      const config = getActiveConfig()
      const concurrency = getConcurrency()
      await api.post("/api/workspace/launch", {
        type: mode,
        accountIds: Array.from(selectedAccountIds),
        applyToAll: false,
        config,
        threads: concurrency,
        delayMin: 2000,
        delayMax: 8000,
      })
      setLaunchStatus("success")
      toast.success("Задача запущена!")
      setStatusMsg("Задача запущена!")
      fetchJobs()
      setTimeout(() => setLaunchStatus("idle"), 3000)
    } catch (err) {
      setLaunchStatus("error")
      const msg = err instanceof ApiError ? err.message : "Ошибка запуска задачи"
      setStatusMsg(msg)
      toast.error(msg)
    }
  }

  const handleCancelTask = async (taskId: string) => {
    setCancellingTaskId(taskId)
    try {
      await api.delete(`/api/workspace/jobs/${taskId}`)
      toast.success("Задача отменена")
      fetchJobs()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Не удалось отменить задачу")
    } finally {
      setCancellingTaskId(null)
    }
  }

  const addHashtag = (target: "warmup" | "upload") => {
    const tag = hashtagInput.trim().replace(/^#/, "")
    if (!tag) return
    if (target === "warmup") {
      if (!warmup.hashtags.includes(tag)) {
        setWarmup({ ...warmup, hashtags: [...warmup.hashtags, tag] })
      }
    } else {
      if (!upload.hashtags.includes(tag)) {
        setUpload({ ...upload, hashtags: [...upload.hashtags, tag] })
      }
    }
    setHashtagInput("")
  }

  const removeHashtag = (target: "warmup" | "upload", tag: string) => {
    if (target === "warmup") {
      setWarmup({ ...warmup, hashtags: warmup.hashtags.filter(h => h !== tag) })
    } else {
      setUpload({ ...upload, hashtags: upload.hashtags.filter(h => h !== tag) })
    }
  }

  const handleWarmupCommentsChange = (value: string) => {
    setWarmupCommentText(value)
    setWarmup((current) => ({
      ...current,
      comments: parseWarmupComments(value),
    }))
  }

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("video", file)
      const res = await fetch(
        `${API_BASE}/api/workspace/upload`,
        { method: "POST", body: formData, credentials: "include" }
      )
      if (!res.ok) throw new Error("Upload failed")
      const data = await res.json()
      setVideos([data.video, ...videos])
      setUpload({ ...upload, videoId: data.video.id })
      toast.success("Видео загружено")
    } catch {
      toast.error("Ошибка загрузки видео")
    } finally {
      setUploading(false)
    }
  }

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingBanner(true)
    try {
      const formData = new FormData()
      formData.append("banner", file)
      const res = await fetch(
        `${API_BASE}/api/workspace/upload-banner`,
        { method: "POST", body: formData, credentials: "include" }
      )
      if (!res.ok) throw new Error("Banner upload failed")
      const data = await res.json()
      setBanners([data.banner, ...banners])
      setUpload({ ...upload, bannerId: data.banner.id })
      toast.success("Баннер загружен")
    } catch {
      toast.error("Ошибка загрузки баннера")
    } finally {
      setUploadingBanner(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append("avatar", file)
      const res = await fetch(
        `${API_BASE}/api/workspace/upload-avatar`,
        { method: "POST", body: formData, credentials: "include" }
      )
      if (!res.ok) throw new Error("Avatar upload failed")
      const data = await res.json()
      setEditProfile({ ...editProfile, avatarUrl: data.filepath })
      toast.success("Аватар загружен")
    } catch {
      toast.error("Ошибка загрузки аватара")
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleDeleteBanner = async (bannerId: string) => {
    try {
      await fetch(
        `${API_BASE}/api/workspace/banner/${bannerId}`,
        { method: "DELETE", credentials: "include" }
      )
      setBanners(banners.filter(b => b.id !== bannerId))
      if (upload.bannerId === bannerId) {
        setUpload({ ...upload, bannerId: "" })
      }
      toast.success("Баннер удалён")
    } catch {
      toast.error("Ошибка удаления баннера")
    }
  }

  const renderHashtags = (tags: string[], target: "warmup" | "upload") => (
    <div className="flex flex-col gap-2">
      <Label><Hash className="size-3 inline mr-1" />Хештеги</Label>
      <div className="flex gap-2">
        <Input
          placeholder="Введите хештег..."
          value={hashtagInput}
          onChange={e => setHashtagInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addHashtag(target) } }}
        />
        <Button variant="outline" size="icon" onClick={() => addHashtag(target)} type="button">
          <span className="text-lg">+</span>
        </Button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <Badge key={tag} variant="secondary" className="gap-1 pl-2.5">
              #{tag}
              <button onClick={() => removeHashtag(target, tag)} className="hover:text-destructive transition-colors ml-1">
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )

  const renderModeForm = () => {
    switch (mode) {
      case "WARMUP":
        return (
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <div className="flex flex-col gap-2 flex-1">
                <Label htmlFor="warmup-mode">Режим прогрева</Label>
                <Select value={warmup.warmupMode} onValueChange={(v: "DAYS" | "HOURS" | null) => v && setWarmup({ ...warmup, warmupMode: v })}>
                  <SelectTrigger id="warmup-mode">
                    <SelectValue placeholder="Режим" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAYS">Полноценный (Дни)</SelectItem>
                    <SelectItem value="HOURS">Ускоренный (часы)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="warmup-concurrency">Потоки</Label>
                <Input id="warmup-concurrency" type="number" min={1} max={10}
                  value={warmup.concurrency}
                  onChange={e => setWarmup({ ...warmup, concurrency: parseInt(e.target.value) || 3 })}
                />
              </div>
              {warmup.warmupMode === "DAYS" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="warmup-days">Дней прогрева</Label>
                  <Input id="warmup-days" type="number" min={1} max={21}
                    value={warmup.warmupDays}
                    onChange={e => setWarmup({ ...warmup, warmupDays: parseInt(e.target.value) || 10 })}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="warmup-hours">Часов (Без остановки)</Label>
                  <Input id="warmup-hours" type="number" min={1} max={24}
                    value={warmup.warmupHours}
                    onChange={e => setWarmup({ ...warmup, warmupHours: parseInt(e.target.value) || 2 })}
                  />
                </div>
              )}
            </div>
            {warmup.warmupMode === "HOURS" && (
              <Alert>
                <AlertCircle className="size-4" />
                <AlertDescription>
                  Ускоренный режим засчитает прогрев после выбранного количества часов и откроет заливы. Это быстрее, но рискованнее для свежих аккаунтов, чем режим по дням.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox id="warmup-rotation"
                  checked={warmup.useRotation}
                  onCheckedChange={(v) => setWarmup({ ...warmup, useRotation: !!v })}
                />
                <Label htmlFor="warmup-rotation" className="mb-0 cursor-pointer text-sm">Ротация IP</Label>
              </div>
            </div>
            {renderHashtags(warmup.hashtags, "warmup")}
            <div className="flex flex-col gap-2">
              <Label htmlFor="warmup-comments">Комментарии</Label>
              <Textarea
                id="warmup-comments"
                rows={5}
                placeholder={"Отличный ролик\nОчень живой монтаж\nСохранил себе"}
                value={warmupCommentText}
                onChange={(e) => handleWarmupCommentsChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                По одному комментарию на строку. Если поле пустое, прогрев не будет оставлять комментарии.
              </p>
            </div>
          </div>
        )

      case "COOKIES":
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cookies-threads">Потоки</Label>
              <Input id="cookies-threads" type="number" min={1} max={20}
                value={cookies.concurrency}
                onChange={e => setCookies({ ...cookies, concurrency: parseInt(e.target.value) || 1 })}
              />
            </div>
            <Alert>
              <AlertDescription className="text-sm text-muted-foreground">
                Автоматический сбор cookies со всех активных аккаунтов. Браузер откроет каждый аккаунт и сохранит cookies для последующей авторизации.
              </AlertDescription>
            </Alert>
          </div>
        )

      case "EDIT_PROFILE":
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-threads">Потоки</Label>
              <Input id="edit-threads" type="number" min={1} max={20}
                value={editProfile.concurrency}
                onChange={e => setEditProfile({ ...editProfile, concurrency: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-nickname">Новый никнейм</Label>
              <Input id="edit-nickname" placeholder="Оставьте пустым для пропуска"
                value={editProfile.nickname}
                onChange={e => setEditProfile({ ...editProfile, nickname: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-bio">Новое описание (bio)</Label>
              <Textarea id="edit-bio" rows={3} placeholder="Оставьте пустым для пропуска"
                value={editProfile.bio}
                onChange={e => setEditProfile({ ...editProfile, bio: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Аватар</Label>
              <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 transition-colors">
                {uploadingAvatar ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <Image className="size-4 text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground">
                  {uploadingAvatar ? "Загрузка..." : "Выберите файл (.jpg, .png)"}
                </span>
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif" className="hidden"
                  onChange={handleAvatarUpload} disabled={uploadingAvatar}
                />
              </label>

              {editProfile.avatarUrl && (
                <div className="flex items-center justify-between p-2 mt-1 border rounded-md bg-secondary/20">
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={editProfile.avatarUrl}>
                    {editProfile.avatarUrl.split(/[/\\]/).pop()}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive"
                    onClick={() => setEditProfile({ ...editProfile, avatarUrl: "" })}>
                    <Trash2 className="size-3 mr-1" /> Удалить
                  </Button>
                </div>
              )}
            </div>
          </div>
        )

      case "UPLOAD":
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="upload-threads">Потоки</Label>
              <Input id="upload-threads" type="number" min={1} max={20}
                value={upload.concurrency}
                onChange={e => setUpload({ ...upload, concurrency: parseInt(e.target.value) || 1 })}
              />
            </div>

            {/* Video upload */}
            <div className="flex flex-col gap-2">
              <Label>Видео для загрузки</Label>
              <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 transition-colors">
                {uploading ? (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="size-5 text-muted-foreground" />
                )}
                <span className="text-sm text-muted-foreground">
                  {uploading ? "Загрузка..." : "Нажмите для загрузки видео (.mp4, .webm, .mov)"}
                </span>
                <input type="file" accept=".mp4,.webm,.mov,.avi" className="hidden"
                  onChange={handleVideoUpload} disabled={uploading}
                />
              </label>

              {videos.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Select value={upload.videoId} onValueChange={(v) => setUpload({ ...upload, videoId: v ?? "" })}>
                      <SelectTrigger>
                        <SelectValue placeholder="-- Выберите видео --" />
                      </SelectTrigger>
                      <SelectContent>
                        {videos.map(v => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.originalName} ({(v.size / 1024 / 1024).toFixed(1)} MB)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {upload.videoId && (
                    <Button variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setUpload({ ...upload, videoId: "" })}>
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Banner upload */}
            <div className="flex flex-col gap-2">
              <Label>Баннер (необязательно)</Label>
              <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 transition-colors">
                {uploadingBanner ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <Image className="size-4 text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground">
                  {uploadingBanner ? "Загрузка..." : "Загрузить баннер (.mp4, .webm, .mov)"}
                </span>
                <input type="file" accept=".mp4,.webm,.mov" className="hidden"
                  onChange={handleBannerUpload} disabled={uploadingBanner}
                />
              </label>

              {banners.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <Select value={upload.bannerId} onValueChange={(v) => setUpload({ ...upload, bannerId: v ?? "" })}>
                        <SelectTrigger>
                          <SelectValue placeholder="-- Без баннера --" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Без баннера</SelectItem>
                          {banners.map(b => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.originalName} ({(b.size / 1024 / 1024).toFixed(1)} MB)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {upload.bannerId && upload.bannerId !== "none" && (
                      <Button variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setUpload({ ...upload, bannerId: "" })}>
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                  {upload.bannerId && upload.bannerId !== "none" && (
                    <Button variant="ghost" size="sm" className="self-end text-xs text-destructive"
                      onClick={() => handleDeleteBanner(upload.bannerId)}>
                      <Trash2 className="size-3 mr-1" /> Удалить баннер
                    </Button>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Баннер накладывается на видео сверху или снизу (рандомно). Поддерживаются файлы с прозрачностью и MP4 с чёрным фоном.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="upload-title">Заголовок</Label>
              <Input id="upload-title" placeholder="Заголовок видео"
                value={upload.title}
                onChange={e => setUpload({ ...upload, title: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="upload-desc">Описание</Label>
              <Textarea id="upload-desc" rows={3} placeholder="Описание видео"
                value={upload.description}
                onChange={e => setUpload({ ...upload, description: e.target.value })}
              />
            </div>
            {renderHashtags(upload.hashtags, "upload")}
          </div>
        )



      default:
        return null
    }
  }

  const renderTaskStatus = (task: WorkspaceTask) => {
    if (task.status === "COMPLETED") {
      return <Badge variant="default" className="gap-1"><CheckCircle className="size-3" />{TASK_STATUS_LABELS[task.status]}</Badge>
    }
    if (task.status === "FAILED") {
      return <Badge variant="destructive" className="gap-1"><AlertCircle className="size-3" />{TASK_STATUS_LABELS[task.status]}</Badge>
    }
    if (task.status === "CANCELLED") {
      return <Badge variant="outline">{TASK_STATUS_LABELS[task.status]}</Badge>
    }
    return <Badge variant="secondary">{TASK_STATUS_LABELS[task.status]}</Badge>
  }

  const renderTasksPanel = () => {
    const visibleJobs = jobs.slice(0, 8)

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Задачи</CardTitle>
            <Button variant="ghost" size="icon" className="size-8" onClick={fetchJobs} disabled={jobsLoading} title="Обновить задачи">
              <RefreshCw className={`size-4 ${jobsLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {visibleJobs.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Активных задач пока нет
            </div>
          ) : (
            visibleJobs.map((task) => {
              const canCancel = task.status === "PENDING" || task.status === "RUNNING"
              const progress = Math.max(0, Math.min(100, task.progress ?? (task.status === "COMPLETED" ? 100 : 0)))

              return (
                <div key={task.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{TASK_TYPE_LABELS[task.type] || task.type}</span>
                        {renderTaskStatus(task)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {new Date(task.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    {canCancel && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => handleCancelTask(task.id)}
                        disabled={cancellingTaskId === task.id}
                        title="Отменить задачу"
                      >
                        {cancellingTaskId === task.id ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
                      </Button>
                    )}
                  </div>
                  {(task.status === "RUNNING" || progress > 0) && (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                  {(task.vncSessions?.length || 0) > 0 && (
                    <div className="mt-3 flex flex-col gap-2">
                      {task.vncSessions!.map((session) => (
                        <div key={session.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-w-0 flex-1 justify-start text-xs"
                            onClick={() => setSelectedMonitor({ task, session })}
                            title="Открыть монитор"
                          >
                            <Monitor className="size-3.5" />
                            <span className="truncate">{session.accountLabel}</span>
                            <Badge variant="secondary" className="ml-auto text-[10px]">
                              {session.platform === "TIKTOK" ? "TT" : "YT"}
                            </Badge>
                          </Button>
                          <a
                            href={session.monitorUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="Открыть в новой вкладке"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                  {(task.error || task.cancelReason) && (
                    <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {task.error || task.cancelReason}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col gap-6 max-w-6xl mx-auto"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Воркспейс</h1>
        <p className="text-sm text-muted-foreground mt-1">Запуск и управление задачами автоматизации</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="size-4" />
                Конфигурация задачи
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {/* Mode Tabs */}
              <Tabs value={mode} onValueChange={setMode}>
                <TabsList className="w-full grid grid-cols-4">
                  <TabsTrigger value="WARMUP" className="text-xs">Прогрев</TabsTrigger>
                  <TabsTrigger value="COOKIES" className="text-xs">Куки</TabsTrigger>
                  <TabsTrigger value="EDIT_PROFILE" className="text-xs">Профиль</TabsTrigger>
                  <TabsTrigger value="UPLOAD" className="text-xs">Залив</TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Account selector */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Users className="size-4" />
                    Аккаунты
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      if (selectedAccountIds.size === accounts.length) {
                        setSelectedAccountIds(new Set())
                      } else {
                        setSelectedAccountIds(new Set(accounts.map(a => a.id)))
                      }
                    }}
                  >
                    {selectedAccountIds.size === accounts.length ? "Снять все" : "Выбрать все"}
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Выбрано: {selectedAccountIds.size} из {accounts.length}
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-accent/30 p-2 flex flex-col gap-1">
                  {accounts.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-4">Нет аккаунтов</div>
                  ) : (
                    accounts.map(acc => (
                      <label key={acc.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer transition-colors duration-150">
                        <Checkbox
                          checked={selectedAccountIds.has(acc.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedAccountIds)
                            if (checked) next.add(acc.id)
                            else next.delete(acc.id)
                            setSelectedAccountIds(next)
                          }}
                        />
                        <span className="text-sm truncate flex-1">{acc.username || acc.id.slice(0, 8)}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {acc.platform === 'TIKTOK' ? 'TT' : 'YT'}
                        </Badge>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <Separator />

              {/* Mode-specific form */}
              {renderModeForm()}

              <Separator />

              {/* Presets */}
              <div className="flex items-center gap-2">
                <Select value={selectedPresetId} onValueChange={(v) => handleLoadPreset(v ?? "")}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="-- Загрузить пресет --" />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" className="shrink-0" onClick={handleSavePreset}>
                  <Save className="size-4 mr-1" />
                  Сохранить
                </Button>
              </div>

              {/* Launch Button */}
              <Button
                size="lg"
                className="w-full active:scale-[0.97] transition-transform"
                onClick={handleLaunch}
                disabled={launchStatus === "launching" || selectedAccountIds.size === 0}
              >
                {launchStatus === "launching" ? (
                  <>
                    <Loader2 className="size-5 mr-2 animate-spin" />
                    Подготовка...
                  </>
                ) : (
                  <>
                    <Play className="size-5 mr-2" />
                    Запустить задачу
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="sticky top-24">
            <LiveTerminal />
          </div>
          {renderTasksPanel()}
        </div>
      </div>
    </motion.div>
    <Dialog open={!!selectedMonitor} onOpenChange={(open) => { if (!open) setSelectedMonitor(null) }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[1200px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="size-4" />
            VNC Monitor
          </DialogTitle>
          <DialogDescription className="truncate">
            {selectedMonitor
              ? `${TASK_TYPE_LABELS[selectedMonitor.task.type] || selectedMonitor.task.type} - ${selectedMonitor.session.accountLabel}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2">
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            {selectedMonitor ? selectedMonitor.session.jobId.slice(0, 12) : ""}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openAdjacentMonitor(-1)}
              disabled={selectedMonitorIndex <= 0}
              title="Предыдущий монитор"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openAdjacentMonitor(1)}
              disabled={selectedMonitorIndex === -1 || selectedMonitorIndex >= activeMonitors.length - 1}
              title="Следующий монитор"
            >
              <ChevronRight className="size-4" />
            </Button>
            {selectedMonitor && (
              <a
                href={selectedMonitor.session.monitorUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
                Открыть
              </a>
            )}
          </div>
        </div>
        {selectedMonitor && (
          <iframe
            title="VNC monitor"
            src={`${selectedMonitor.session.monitorUrl}?embed=1`}
            className="h-[72vh] min-h-[420px] w-full bg-black"
            allow="clipboard-read; clipboard-write; fullscreen; pointer-lock"
            sandbox="allow-same-origin allow-scripts allow-forms allow-pointer-lock allow-downloads"
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  )
}

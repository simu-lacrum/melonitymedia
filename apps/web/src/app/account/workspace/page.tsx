"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { LiveTerminal } from "@/components/ui/live-terminal"
import { Play, Users, Save, Loader2, CheckCircle, AlertCircle, Upload, X } from "lucide-react"
import { api, ApiError } from "@/lib/api"

interface Preset {
  id: string
  name: string
  config: Record<string, unknown>
}

type LaunchStatus = "idle" | "launching" | "success" | "error"

// ── Config types per mode ──
interface WarmupConfig {
  mode: "WARMUP"
  concurrency: number
  warmupDays: number
  useRotation: boolean
  headless: boolean
  hashtags: string[]
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
}

interface LoginConfig {
  mode: "LOGIN"
  concurrency: number
  headless: boolean
}

const DEFAULT_CONFIGS = {
  WARMUP: {
    mode: "WARMUP", concurrency: 3, warmupDays: 10, useRotation: true,
    headless: true, hashtags: ["dota2", "dota2highlights"],
  } as WarmupConfig,
  COOKIES: {
    mode: "COOKIES", concurrency: 5, headless: true,
  } as CookiesConfig,
  EDIT_PROFILE: {
    mode: "EDIT_PROFILE", concurrency: 3, headless: true,
    bio: "", nickname: "", avatarUrl: "",
  } as EditProfileConfig,
  UPLOAD: {
    mode: "UPLOAD", concurrency: 3, headless: true, videoId: "",
    title: "", description: "", hashtags: [], scheduleAt: "",
  } as UploadConfig,
  LOGIN: {
    mode: "LOGIN", concurrency: 5, headless: true,
  } as LoginConfig,
}

interface VideoFile {
  id: string
  originalName: string
  filename: string
  size: number
  description?: string
  hashtags?: string[]
}

export default function WorkspacePage() {
  const [mode, setMode] = React.useState("WARMUP")
  const [launchStatus, setLaunchStatus] = React.useState<LaunchStatus>("idle")
  const [statusMsg, setStatusMsg] = React.useState("")
  const [presets, setPresets] = React.useState<Preset[]>([])
  const [selectedPresetId, setSelectedPresetId] = React.useState<string>("")
  const [accountCount, setAccountCount] = React.useState(0)

  // Mode-specific configs
  const [warmup, setWarmup] = React.useState<WarmupConfig>({ ...DEFAULT_CONFIGS.WARMUP })
  const [cookies, setCookies] = React.useState<CookiesConfig>({ ...DEFAULT_CONFIGS.COOKIES })
  const [editProfile, setEditProfile] = React.useState<EditProfileConfig>({ ...DEFAULT_CONFIGS.EDIT_PROFILE })
  const [upload, setUpload] = React.useState<UploadConfig>({ ...DEFAULT_CONFIGS.UPLOAD })
  const [login, setLogin] = React.useState<LoginConfig>({ ...DEFAULT_CONFIGS.LOGIN })

  // Hashtag input
  const [hashtagInput, setHashtagInput] = React.useState("")

  // Upload
  const [videos, setVideos] = React.useState<VideoFile[]>([])
  const [uploading, setUploading] = React.useState(false)

  // Load presets + account count on mount
  React.useEffect(() => {
    api.get<{ presets: Preset[] }>("/api/workspace/presets")
      .then((data) => { if (data.presets) setPresets(data.presets) })
      .catch(console.error)

    api.get<{ accounts: any[] }>("/api/accounts")
      .then((data) => setAccountCount(data.accounts?.length ?? 0))
      .catch(() => {})
  }, [])

  // Load videos for upload mode
  React.useEffect(() => {
    if (mode === "UPLOAD") {
      api.get<{ videos: VideoFile[] }>("/api/workspace/videos")
        .then((data) => setVideos(data.videos || []))
        .catch(() => {})
    }
  }, [mode])

  const getActiveConfig = (): Record<string, unknown> => {
    switch (mode) {
      case "WARMUP": return { ...warmup }
      case "COOKIES": return { ...cookies }
      case "EDIT_PROFILE": return { ...editProfile }
      case "UPLOAD": return { ...upload }
      case "LOGIN": return { ...login }
      default: return {}
    }
  }

  const getConcurrency = (): number => {
    switch (mode) {
      case "WARMUP": return warmup.concurrency
      case "COOKIES": return cookies.concurrency
      case "EDIT_PROFILE": return editProfile.concurrency
      case "UPLOAD": return upload.concurrency
      case "LOGIN": return login.concurrency
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
    } catch {
      alert("Ошибка сохранения пресета")
    }
  }

  const handleLoadPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    setSelectedPresetId(id)
    if (!id) return
    const preset = presets.find((p) => p.id === id)
    if (preset) {
      const cfg = preset.config as any
      const m = cfg.mode || mode
      setMode(m)
      switch (m) {
        case "WARMUP": setWarmup({ ...DEFAULT_CONFIGS.WARMUP, ...cfg }); break
        case "COOKIES": setCookies({ ...DEFAULT_CONFIGS.COOKIES, ...cfg }); break
        case "EDIT_PROFILE": setEditProfile({ ...DEFAULT_CONFIGS.EDIT_PROFILE, ...cfg }); break
        case "UPLOAD": setUpload({ ...DEFAULT_CONFIGS.UPLOAD, ...cfg }); break
        case "LOGIN": setLogin({ ...DEFAULT_CONFIGS.LOGIN, ...cfg }); break
      }
    }
  }

  const modes = [
    { id: "WARMUP", label: "Прогрев" },
    { id: "COOKIES", label: "Сбор кук" },
    { id: "EDIT_PROFILE", label: "Ред. профиля" },
    { id: "UPLOAD", label: "Автозалив" },
    { id: "LOGIN", label: "Логин" },
  ]

  const handleLaunch = async () => {
    setLaunchStatus("launching")
    setStatusMsg("")
    try {
      const config = getActiveConfig()
      const concurrency = getConcurrency()
      await api.post("/api/workspace/launch", {
        type: mode,
        accountIds: [],
        applyToAll: true,
        config,
        threads: concurrency,
        delayMin: 2000,
        delayMax: 8000,
      })
      setLaunchStatus("success")
      setStatusMsg("Задача запущена!")
      setTimeout(() => setLaunchStatus("idle"), 3000)
    } catch (err) {
      setLaunchStatus("error")
      if (err instanceof ApiError) {
        setStatusMsg(err.message)
      } else {
        setStatusMsg("Ошибка запуска задачи")
      }
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

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("video", file)
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/workspace/upload`,
        { method: "POST", body: formData, credentials: "include" }
      )
      if (!res.ok) throw new Error("Upload failed")
      const data = await res.json()
      setVideos([data.video, ...videos])
      setUpload({ ...upload, videoId: data.video.id })
    } catch {
      setStatusMsg("Ошибка загрузки видео")
      setLaunchStatus("error")
    } finally {
      setUploading(false)
    }
  }

  // ── Render mode-specific form ──
  const renderModeForm = () => {
    switch (mode) {
      case "WARMUP":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="warmup-threads">Потоки</Label>
                <Input
                  id="warmup-threads"
                  type="number"
                  min={1}
                  max={20}
                  value={warmup.concurrency}
                  onChange={e => setWarmup({ ...warmup, concurrency: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label htmlFor="warmup-days">Дней прогрева</Label>
                <Input
                  id="warmup-days"
                  type="number"
                  min={3}
                  max={21}
                  value={warmup.warmupDays}
                  onChange={e => setWarmup({ ...warmup, warmupDays: parseInt(e.target.value) || 10 })}
                />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="warmup-rotation"
                  checked={warmup.useRotation}
                  onChange={() => setWarmup({ ...warmup, useRotation: !warmup.useRotation })}
                />
                <Label htmlFor="warmup-rotation" className="mb-0 cursor-pointer">Ротация IP</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="warmup-headless"
                  checked={warmup.headless}
                  onChange={() => setWarmup({ ...warmup, headless: !warmup.headless })}
                />
                <Label htmlFor="warmup-headless" className="mb-0 cursor-pointer">Headless</Label>
              </div>
            </div>

            <div>
              <Label>Хештеги для просмотра</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Введите хештег..."
                  value={hashtagInput}
                  onChange={e => setHashtagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addHashtag("warmup") } }}
                />
                <Button variant="secondary" onClick={() => addHashtag("warmup")} type="button">+</Button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {warmup.hashtags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-melon-pink/10 text-melon-pink rounded-full text-caption font-medium"
                  >
                    #{tag}
                    <button onClick={() => removeHashtag("warmup", tag)} className="hover:text-white transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )

      case "COOKIES":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="cookies-threads">Потоки</Label>
              <Input
                id="cookies-threads"
                type="number"
                min={1}
                max={20}
                value={cookies.concurrency}
                onChange={e => setCookies({ ...cookies, concurrency: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cookies-headless"
                checked={cookies.headless}
                onChange={() => setCookies({ ...cookies, headless: !cookies.headless })}
              />
              <Label htmlFor="cookies-headless" className="mb-0 cursor-pointer">Headless режим</Label>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <p className="text-body-sm text-text-muted">
                Автоматический сбор cookies со всех активных аккаунтов. Браузер откроет каждый аккаунт и сохранит cookies для последующей авторизации.
              </p>
            </div>
          </div>
        )

      case "EDIT_PROFILE":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-threads">Потоки</Label>
              <Input
                id="edit-threads"
                type="number"
                min={1}
                max={20}
                value={editProfile.concurrency}
                onChange={e => setEditProfile({ ...editProfile, concurrency: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div>
              <Label htmlFor="edit-nickname">Новый никнейм</Label>
              <Input
                id="edit-nickname"
                placeholder="Оставьте пустым для пропуска"
                value={editProfile.nickname}
                onChange={e => setEditProfile({ ...editProfile, nickname: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-bio">Новое описание (bio)</Label>
              <textarea
                id="edit-bio"
                rows={3}
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-4 py-3 text-body-md text-white placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-melon-pink/50 resize-none"
                placeholder="Оставьте пустым для пропуска"
                value={editProfile.bio}
                onChange={e => setEditProfile({ ...editProfile, bio: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-avatar">URL аватара</Label>
              <Input
                id="edit-avatar"
                placeholder="https://example.com/avatar.jpg"
                value={editProfile.avatarUrl}
                onChange={e => setEditProfile({ ...editProfile, avatarUrl: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-headless"
                checked={editProfile.headless}
                onChange={() => setEditProfile({ ...editProfile, headless: !editProfile.headless })}
              />
              <Label htmlFor="edit-headless" className="mb-0 cursor-pointer">Headless режим</Label>
            </div>
          </div>
        )

      case "UPLOAD":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="upload-threads">Потоки</Label>
              <Input
                id="upload-threads"
                type="number"
                min={1}
                max={20}
                value={upload.concurrency}
                onChange={e => setUpload({ ...upload, concurrency: parseInt(e.target.value) || 1 })}
              />
            </div>

            {/* Video upload */}
            <div>
              <Label>Видео для загрузки</Label>
              <div className="space-y-2">
                <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-white/10 rounded-lg cursor-pointer hover:border-melon-pink/50 transition-colors">
                  {uploading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                  ) : (
                    <Upload className="w-5 h-5 text-text-muted" />
                  )}
                  <span className="text-body-sm text-text-muted">
                    {uploading ? "Загрузка..." : "Нажмите для загрузки видео (.mp4, .webm, .mov)"}
                  </span>
                  <input
                    type="file"
                    accept=".mp4,.webm,.mov,.avi"
                    className="hidden"
                    onChange={handleVideoUpload}
                    disabled={uploading}
                  />
                </label>

                {videos.length > 0 && (
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-body-md text-white"
                    value={upload.videoId}
                    onChange={e => setUpload({ ...upload, videoId: e.target.value })}
                  >
                    <option value="">-- Выберите видео --</option>
                    {videos.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.originalName} ({(v.size / 1024 / 1024).toFixed(1)} MB)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="upload-title">Заголовок</Label>
              <Input
                id="upload-title"
                placeholder="Заголовок видео"
                value={upload.title}
                onChange={e => setUpload({ ...upload, title: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="upload-desc">Описание</Label>
              <textarea
                id="upload-desc"
                rows={3}
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-4 py-3 text-body-md text-white placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-melon-pink/50 resize-none"
                placeholder="Описание видео"
                value={upload.description}
                onChange={e => setUpload({ ...upload, description: e.target.value })}
              />
            </div>

            <div>
              <Label>Хештеги</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Введите хештег..."
                  value={hashtagInput}
                  onChange={e => setHashtagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addHashtag("upload") } }}
                />
                <Button variant="secondary" onClick={() => addHashtag("upload")} type="button">+</Button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {upload.hashtags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-melon-pink/10 text-melon-pink rounded-full text-caption font-medium"
                  >
                    #{tag}
                    <button onClick={() => removeHashtag("upload", tag)} className="hover:text-white transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="upload-headless"
                checked={upload.headless}
                onChange={() => setUpload({ ...upload, headless: !upload.headless })}
              />
              <Label htmlFor="upload-headless" className="mb-0 cursor-pointer">Headless режим</Label>
            </div>
          </div>
        )

      case "LOGIN":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="login-threads">Потоки</Label>
              <Input
                id="login-threads"
                type="number"
                min={1}
                max={20}
                value={login.concurrency}
                onChange={e => setLogin({ ...login, concurrency: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="login-headless"
                checked={login.headless}
                onChange={() => setLogin({ ...login, headless: !login.headless })}
              />
              <Label htmlFor="login-headless" className="mb-0 cursor-pointer">Headless режим</Label>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <p className="text-body-sm text-text-muted">
                Автоматический логин на всех аккаунтах через cookies. Проверяет валидность сессий и переавторизуется при необходимости.
              </p>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6 max-w-6xl mx-auto"
    >
      <div>
        <h1 className="text-display-sm mb-2">Воркспейс</h1>
        <p className="text-body-md text-text-muted">Запуск и управление задачами автоматизации</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Конфигурация задачи</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Режим работы</Label>
                <SegmentedControl
                  segments={modes}
                  activeSegment={mode}
                  onChange={setMode}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="mb-0">Аккаунты для работы</Label>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-input p-4 flex items-center space-x-3">
                  <Users className="w-5 h-5 text-text-muted" />
                  <div>
                    <div className="font-medium text-white">{accountCount} аккаунтов</div>
                    <div className="text-caption text-text-muted">Все активные (ALIVE)</div>
                  </div>
                </div>
              </div>

              {/* Mode-specific form */}
              <div className="border-t border-white/5 pt-5">
                {renderModeForm()}
              </div>

              {/* Presets */}
              <div className="flex items-center gap-2 border-t border-white/5 pt-4">
                <select
                  className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white"
                  value={selectedPresetId}
                  onChange={handleLoadPreset}
                >
                  <option value="">-- Загрузить пресет --</option>
                  {presets.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <Button variant="ghost" size="sm" className="h-8 text-text-muted shrink-0" onClick={handleSavePreset}>
                  <Save className="w-4 h-4 mr-1" />
                  Сохранить
                </Button>
              </div>

              {/* Status message */}
              {statusMsg && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-body-sm ${
                  launchStatus === "success"
                    ? "bg-[#00d287]/10 text-[#00d287] border border-[#00d287]/20"
                    : "bg-[#F43F5E]/10 text-[#F43F5E] border border-[#F43F5E]/20"
                }`}>
                  {launchStatus === "success" ? (
                    <CheckCircle className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{statusMsg}</span>
                </div>
              )}

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={handleLaunch}
                disabled={launchStatus === "launching"}
              >
                {launchStatus === "launching" ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Подготовка...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    Запустить задачу
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7">
          <div className="sticky top-24">
            <LiveTerminal />
          </div>
        </div>
      </div>
    </motion.div>
  )
}

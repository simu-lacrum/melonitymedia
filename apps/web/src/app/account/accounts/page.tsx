"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Search, Plus, Trash2, RefreshCw, MoreVertical, Loader2, Shield, KeyRound, RotateCcw, Clock, AlertCircle } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { io, Socket } from "socket.io-client"

interface SocialAccount {
  id: string
  platform: string
  username: string
  status: string
  followers: number
  lastActive?: string
  updatedAt: string
  pinnedProxy?: {
    id: string
    host: string
    port: number
    carrier?: string
  } | null
  pinnedProxyId?: string | null
}

interface ProxyItem {
  id: string
  host: string
  port: number
}

export default function AccountsPage() {
  const [accounts, setAccounts] = React.useState<SocialAccount[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [search, setSearch] = React.useState("")
  const [platformFilter, setPlatformFilter] = React.useState<"ALL" | "TIKTOK" | "YOUTUBE">("ALL")

  // Import dialog state
  const [importOpen, setImportOpen] = React.useState(false)
  const [importText, setImportText] = React.useState("")
  const [importLoading, setImportLoading] = React.useState(false)
  const [importPlatform, setImportPlatform] = React.useState<string>("TIKTOK")
  const [importMethod, setImportMethod] = React.useState<string>("cookies")
  const [importProxyId, setImportProxyId] = React.useState<string>("")
  const [availableProxies, setAvailableProxies] = React.useState<ProxyItem[]>([])

  // Proxy bind dialog state
  const [proxyBindOpen, setProxyBindOpen] = React.useState(false)
  const [proxyBindAccountId, setProxyBindAccountId] = React.useState("")
  const [proxyBindValue, setProxyBindValue] = React.useState("")
  const [bindingProxy, setBindingProxy] = React.useState(false)

  // 2FA dialog state
  const [twoFAOpen, setTwoFAOpen] = React.useState(false)
  const [twoFAAccountId, setTwoFAAccountId] = React.useState("")
  const [twoFACode, setTwoFACode] = React.useState("")
  const [twoFAHint, setTwoFAHint] = React.useState("")
  const [twoFAType, setTwoFAType] = React.useState("")
  const [twoFALoading, setTwoFALoading] = React.useState(false)
  const [twoFATimeout, setTwoFATimeout] = React.useState(600) // seconds
  const twoFATimerRef = React.useRef<NodeJS.Timeout | null>(null)

  // Verification error display
  const [verifyErrors, setVerifyErrors] = React.useState<Record<string, string>>({})

  const fetchAccounts = React.useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.get<{ accounts: SocialAccount[] }>("/api/accounts")
      setAccounts(data.accounts)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Не удалось загрузить аккаунты")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  React.useEffect(() => {
    if (importOpen || proxyBindOpen) {
      api.get<{ proxies: ProxyItem[] }>("/api/proxies")
        .then(data => setAvailableProxies(data.proxies || []))
        .catch(() => {})
    }
  }, [importOpen, proxyBindOpen])

  // Socket.io connection for login verification events
  React.useEffect(() => {
    const socket: Socket = io(
      `${process.env.NEXT_PUBLIC_API_URL || ""}/logs`,
      { withCredentials: true, transports: ["websocket", "polling"] }
    )

    socket.on("login:success", (data: { accountId: string; message: string; username?: string }) => {
      toast.success(data.message || "Аккаунт верифицирован")
      setVerifyErrors(prev => { const n = { ...prev }; delete n[data.accountId]; return n })
      fetchAccounts()
    })

    socket.on("login:failed", (data: { accountId: string; code: string; message: string }) => {
      toast.error(data.message || "Ошибка верификации")
      setVerifyErrors(prev => ({ ...prev, [data.accountId]: data.message }))
      fetchAccounts()
    })

    socket.on("login:2fa_required", (data: { accountId: string; type: string; hint: string; timeoutSeconds: number }) => {
      setTwoFAAccountId(data.accountId)
      setTwoFAHint(data.hint)
      setTwoFAType(data.type)
      setTwoFATimeout(data.timeoutSeconds || 600)
      setTwoFACode("")
      setTwoFAOpen(true)
      toast.info(data.hint || "Требуется код подтверждения")
    })

    return () => {
      socket.disconnect()
    }
  }, [fetchAccounts])

  // 2FA countdown timer
  React.useEffect(() => {
    if (twoFAOpen && twoFATimeout > 0) {
      twoFATimerRef.current = setInterval(() => {
        setTwoFATimeout(prev => {
          if (prev <= 1) {
            clearInterval(twoFATimerRef.current!)
            setTwoFAOpen(false)
            toast.error("Время ожидания кода истекло")
            return 0
          }
          return prev - 1
        })
      }, 1000)
      return () => { if (twoFATimerRef.current) clearInterval(twoFATimerRef.current) }
    }
  }, [twoFAOpen])

  const filtered = accounts
    .filter(a => platformFilter === "ALL" || a.platform === platformFilter)
    .filter(a => a.username?.toLowerCase().includes(search.toLowerCase()))

  const toggleAll = () => {
    setSelectedIds(selectedIds.length === filtered.length ? [] : filtered.map((a) => a.id))
  }

  const toggleOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleDelete = async () => {
    if (!confirm(`Удалить ${selectedIds.length} аккаунтов?`)) return
    try {
      await api.post("/api/accounts/bulk-delete", { ids: selectedIds })
      toast.success(`Удалено ${selectedIds.length} аккаунтов`)
      setSelectedIds([])
      fetchAccounts()
    } catch {
      toast.error("Ошибка удаления")
    }
  }

  const handleImport = async () => {
    if (!importText.trim()) return
    try {
      setImportLoading(true)
      const result = await api.post<{ created: number; failed: number; message: string }>("/api/accounts/import", {
        raw: importText,
        platform: importPlatform,
        proxyId: importProxyId && importProxyId !== "none" ? importProxyId : undefined,
        method: importMethod,
      })
      toast.success(result.message || `${result.created} аккаунтов отправлены на верификацию`)
      setImportOpen(false)
      setImportText("")
      setImportPlatform("TIKTOK")
      setImportMethod("cookies")
      setImportProxyId("")
      fetchAccounts()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Не удалось импортировать")
    } finally {
      setImportLoading(false)
    }
  }

  const handleDeleteSingle = async (id: string) => {
    if (!confirm("Удалить аккаунт?")) return
    try {
      await api.post("/api/accounts/bulk-delete", { ids: [id] })
      toast.success("Аккаунт удалён")
      fetchAccounts()
    } catch {
      toast.error("Ошибка удаления")
    }
  }

  const handleRefreshCookies = async (id: string) => {
    try {
      await api.post("/api/workspace/launch", {
        type: "COOKIES",
        accountIds: [id],
        applyToAll: false,
        config: { mode: "COOKIES", concurrency: 1, headless: true },
        threads: 1,
        delayMin: 0,
        delayMax: 0,
      })
      toast.success("Сбор куки запущен")
    } catch {
      toast.error("Ошибка запуска")
    }
  }

  const handleBindProxy = (accountId: string) => {
    setProxyBindAccountId(accountId)
    setProxyBindValue("")
    setProxyBindOpen(true)
  }

  const handleConfirmBindProxy = async () => {
    setBindingProxy(true)
    try {
      await api.patch(`/api/accounts/${proxyBindAccountId}`, {
        pinnedProxyId: proxyBindValue === "none" ? null : proxyBindValue,
      })
      toast.success("Прокси привязан")
      setProxyBindOpen(false)
      setProxyBindValue("")
      fetchAccounts()
    } catch {
      toast.error("Ошибка привязки прокси")
    } finally {
      setBindingProxy(false)
    }
  }

  const handleRetryLogin = async (id: string, status?: string) => {
    try {
      const forceParam = status === 'BANNED' ? '?force=true' : ''
      if (status === 'BANNED') {
        toast.warning('Аккаунт заблокирован — повторный вход маловероятно поможет')
      }
      await api.post(`/api/accounts/${id}/retry-login${forceParam}`)
      toast.success("Повторная верификация запущена")
      setVerifyErrors(prev => { const n = { ...prev }; delete n[id]; return n })
      fetchAccounts()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Ошибка повторного входа")
    }
  }

  const handleSubmit2FA = async () => {
    if (!twoFACode.trim()) return
    setTwoFALoading(true)
    try {
      await api.post(`/api/accounts/${twoFAAccountId}/verify-code`, { code: twoFACode.trim() })
      toast.success("Код отправлен, ожидаем подтверждение...")
      setTwoFAOpen(false)
      if (twoFATimerRef.current) clearInterval(twoFATimerRef.current)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Ошибка отправки кода")
    } finally {
      setTwoFALoading(false)
    }
  }

  const renderStatus = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      ALIVE: { label: "Живой", variant: "default" },
      AUTH_NEEDED: { label: "Нужна авториз.", variant: "outline" },
      BANNED: { label: "Бан", variant: "destructive" },
      EXPIRED_COOKIES: { label: "Куки умерли", variant: "destructive" },
      SHADOWBAN_SUSPECTED: { label: "Теневой бан?", variant: "outline" },
      WARMING_UP: { label: "Прогрев", variant: "secondary" },
      PAUSED: { label: "Пауза", variant: "secondary" },
      VERIFYING: { label: "Проверка...", variant: "secondary" },
    }
    const cfg = map[status] || { label: status, variant: "secondary" as const }
    if (status === "VERIFYING") {
      return (
        <Badge variant={cfg.variant} className="animate-pulse gap-1.5">
          <Loader2 className="size-3 animate-spin" />
          {cfg.label}
        </Badge>
      )
    }
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="flex flex-col gap-6"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Управление аккаунтами</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Всего: {accounts.length} аккаунтов
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={fetchAccounts} disabled={loading}>
              <RefreshCw className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Синхронизировать
            </Button>
            <Button onClick={() => setImportOpen(true)}>
              <Plus className="size-4 mr-2" />
              Добавить
            </Button>
          </div>
        </div>

        {/* Platform Tabs */}
        <Tabs value={platformFilter} onValueChange={(v) => setPlatformFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="ALL">
              Все <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">{accounts.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="TIKTOK">
              TikTok <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">{accounts.filter(a => a.platform === "TIKTOK").length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="YOUTUBE">
              YouTube <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">{accounts.filter(a => a.platform === "YOUTUBE").length}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Table Card */}
        <Card>
          <CardContent className="p-0">
            {/* Search */}
            <div className="p-4 border-b border-border flex items-center">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по юзернейму..."
                  className="pl-10 bg-transparent"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Content */}
            <div className="relative">
              {loading && accounts.length === 0 ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground">
                  <Loader2 className="size-6 animate-spin mr-3" />
                  <span>Загрузка аккаунтов...</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <span className="text-sm">Аккаунты не найдены</span>
                  <span className="text-xs mt-1">Попробуйте изменить поисковый запрос или добавьте аккаунты</span>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px] pl-6">
                        <Checkbox
                          checked={selectedIds.length === filtered.length && filtered.length > 0}
                          onCheckedChange={toggleAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>Аккаунт</TableHead>
                      <TableHead>Платформа</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Прокси</TableHead>
                      <TableHead>Аудитория</TableHead>
                      <TableHead>Активность</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((acc) => (
                      <TableRow key={acc.id} data-state={selectedIds.includes(acc.id) ? "selected" : undefined}>
                        <TableCell className="pl-6">
                          <Checkbox
                            checked={selectedIds.includes(acc.id)}
                            onCheckedChange={() => toggleOne(acc.id)}
                            aria-label={`Select ${acc.username}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="size-8">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {(acc.username || "?").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium text-foreground">{acc.username || "—"}</div>
                              <div className="text-xs text-muted-foreground">ID: {acc.id.slice(0, 8)}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {acc.platform === "TIKTOK" ? "TikTok" : "YouTube"}
                          </Badge>
                        </TableCell>
                        <TableCell>{renderStatus(acc.status)}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-accent px-2 py-1 rounded">
                            {acc.pinnedProxy
                              ? `${acc.pinnedProxy.host}:${acc.pinnedProxy.port}`
                              : "—"}
                          </code>
                        </TableCell>
                        <TableCell>{(acc.followers ?? 0).toLocaleString()}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{timeAgo(acc.updatedAt)}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex items-center justify-center size-8 rounded-md hover:bg-accent transition-colors">
                              <MoreVertical className="size-4 text-muted-foreground" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleBindProxy(acc.id)}>
                                <Shield className="size-4 mr-2" />Привязать прокси
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleRefreshCookies(acc.id)}>
                                <RefreshCw className="size-4 mr-2" />Обновить куки
                              </DropdownMenuItem>
                              {["AUTH_NEEDED", "EXPIRED_COOKIES", "BANNED"].includes(acc.status) && (
                                <DropdownMenuItem onClick={() => handleRetryLogin(acc.id, acc.status)}>
                                  <RotateCcw className="size-4 mr-2" />Повторить вход
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteSingle(acc.id)}>
                                <Trash2 className="size-4 mr-2" />Удалить
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Bulk Actions Bar */}
              <AnimatePresence>
                {selectedIds.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-card px-6 py-3 rounded-lg flex items-center gap-4 border border-border shadow-lg"
                  >
                    <span className="text-sm font-medium">Выбрано: {selectedIds.length}</span>
                    <Separator orientation="vertical" className="h-4" />
                    <Button variant="ghost" size="sm" onClick={async () => {
                      try {
                        await api.post("/api/workspace/launch", {
                          type: "COOKIES",
                          accountIds: selectedIds,
                          applyToAll: false,
                          config: { mode: "COOKIES", concurrency: 3, headless: true },
                          threads: 3,
                          delayMin: 2000,
                          delayMax: 5000,
                        })
                        toast.success(`Сбор куки запущен для ${selectedIds.length} аккаунтов`)
                      } catch {
                        toast.error("Ошибка запуска")
                      }
                    }}>
                      <RefreshCw className="size-4 mr-2" />
                      Обновить куки
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={handleDelete}
                    >
                      <Trash2 className="size-4 mr-2" />
                      Удалить
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Импорт аккаунтов</DialogTitle>
            <DialogDescription>Добавьте аккаунты через cookies или login:password</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* Platform */}
            <div className="flex flex-col gap-2">
              <Label>Платформа</Label>
              <Select value={importPlatform} onValueChange={(v) => setImportPlatform(v ?? "TIKTOK")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TIKTOK">TikTok</SelectItem>
                  <SelectItem value="YOUTUBE">YouTube</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Method tabs */}
            <Tabs value={importMethod} onValueChange={setImportMethod}>
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="cookies">Cookies</TabsTrigger>
                <TabsTrigger value="credentials">Login:Password</TabsTrigger>
              </TabsList>
              <TabsContent value="cookies" className="mt-3">
                <Textarea
                  className="h-40 font-mono text-sm resize-none"
                  placeholder={'[{"name": "sid_tt", "value": "...", ...}]\n\nВставьте JSON с cookies'}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  disabled={importLoading}
                />
              </TabsContent>
              <TabsContent value="credentials" className="mt-3">
                <Textarea
                  className="h-40 font-mono text-sm resize-none"
                  placeholder={"login:password\nlogin2:password2\n\nПо одному на строку"}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  disabled={importLoading}
                />
              </TabsContent>
            </Tabs>

            {/* Proxy */}
            <div className="flex flex-col gap-2">
              <Label>Привязать прокси (опционально)</Label>
              <Select value={importProxyId} onValueChange={(v) => setImportProxyId(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="Без прокси" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без прокси</SelectItem>
                  {availableProxies.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.host}:{p.port}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importLoading}>Отмена</Button>
            <Button onClick={handleImport} disabled={importLoading || !importText.trim()} className="active:scale-[0.97] transition-transform">
              {importLoading ? <><Loader2 className="size-4 mr-2 animate-spin" />Импорт...</> : "Импортировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Proxy Bind Dialog */}
      <Dialog open={proxyBindOpen} onOpenChange={setProxyBindOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Привязка прокси</DialogTitle>
            <DialogDescription>Выберите прокси для аккаунта</DialogDescription>
          </DialogHeader>
          <Select value={proxyBindValue} onValueChange={(v) => setProxyBindValue(v ?? "")}>
            <SelectTrigger><SelectValue placeholder="Выберите прокси" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Без прокси</SelectItem>
              {availableProxies.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.host}:{p.port}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProxyBindOpen(false)}>Отмена</Button>
            <Button onClick={handleConfirmBindProxy} disabled={bindingProxy} className="active:scale-[0.97] transition-transform">
              {bindingProxy ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Привязать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 2FA Verification Dialog */}
      <Dialog open={twoFAOpen} onOpenChange={(open) => {
        if (!open && twoFATimerRef.current) clearInterval(twoFATimerRef.current)
        setTwoFAOpen(open)
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5" />
              Код подтверждения
            </DialogTitle>
            <DialogDescription>
              {twoFAHint || "Платформа запросила код подтверждения"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* Timer */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-4" />
              <span>Осталось: {Math.floor(twoFATimeout / 60)}:{(twoFATimeout % 60).toString().padStart(2, "0")}</span>
              {twoFATimeout < 60 && (
                <Badge variant="destructive" className="text-xs">Мало времени!</Badge>
              )}
            </div>

            {/* Code input */}
            <div className="flex flex-col gap-2">
              <Label>Введите код {twoFAType === "email" ? "из email" : twoFAType === "sms" ? "из SMS" : twoFAType === "authenticator" ? "из приложения" : "подтверждения"}</Label>
              <Input
                placeholder="123456"
                value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
                className="text-center text-2xl font-mono tracking-[0.3em] h-14"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit2FA() }}
                disabled={twoFALoading}
              />
            </div>

            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-accent/50 p-3 rounded-lg">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>Код будет отправлен воркеру, который введёт его в браузере. После отправки дождитесь результата.</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setTwoFAOpen(false)
              if (twoFATimerRef.current) clearInterval(twoFATimerRef.current)
            }} disabled={twoFALoading}>Отмена</Button>
            <Button onClick={handleSubmit2FA} disabled={twoFALoading || !twoFACode.trim()} className="active:scale-[0.97] transition-transform">
              {twoFALoading ? <><Loader2 className="size-4 mr-2 animate-spin" />Отправка...</> : "Подтвердить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "сейчас"
  if (mins < 60) return `${mins} мин назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.floor(hours / 24)} дн назад`
}

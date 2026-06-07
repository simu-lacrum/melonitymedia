"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Search, Plus, Trash2, RefreshCw, MoreVertical, Loader2, AlertCircle } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { toast } from "sonner"

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
}

export default function AccountsPage() {
  const [accounts, setAccounts] = React.useState<SocialAccount[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [search, setSearch] = React.useState("")
  const [importOpen, setImportOpen] = React.useState(false)
  const [importText, setImportText] = React.useState("")
  const [importLoading, setImportLoading] = React.useState(false)

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

  const filtered = accounts.filter(
    (a) => a.username?.toLowerCase().includes(search.toLowerCase())
  )

  const toggleAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filtered.map((a) => a.id))
    }
  }

  const toggleOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleDelete = async () => {
    if (!confirm(`Удалить ${selectedIds.length} аккаунтов?`)) return
    try {
      await api.delete("/api/accounts/bulk", { ids: selectedIds })
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
      await api.post("/api/accounts/import", { raw: importText })
      toast.success("Аккаунты импортированы")
      setImportOpen(false)
      setImportText("")
      fetchAccounts()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Не удалось импортировать")
    } finally {
      setImportLoading(false)
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
    }
    const cfg = map[status] || { label: status, variant: "secondary" as const }
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
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
                          <span className="font-semibold text-sm">{acc.platform === "TIKTOK" ? "TikTok" : "YouTube"}</span>
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
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreVertical className="size-4 text-muted-foreground" />
                          </Button>
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
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 liquid-glass px-6 py-3 rounded-full flex items-center gap-4 border border-border"
                  >
                    <span className="text-sm font-medium">Выбрано: {selectedIds.length}</span>
                    <Separator orientation="vertical" className="h-4" />
                    <Button variant="ghost" size="sm">
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
            <DialogDescription>
              Вставьте данные аккаунтов в формате login:password или JSON с куками
            </DialogDescription>
          </DialogHeader>

          <Textarea
            className="h-40 font-mono text-sm resize-none"
            placeholder={"login:password\nlogin2:password2\n\nили JSON с куками..."}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            disabled={importLoading}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importLoading}>
              Отмена
            </Button>
            <Button onClick={handleImport} disabled={importLoading || !importText.trim()}>
              {importLoading ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Импорт...
                </>
              ) : (
                "Импортировать"
              )}
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

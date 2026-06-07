"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Avatar } from "@/components/ui/avatar"
import { Search, Plus, Trash2, RefreshCw, MoreVertical, Loader2, AlertCircle, X } from "lucide-react"
import { api, ApiError } from "@/lib/api"

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
  const [error, setError] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [search, setSearch] = React.useState("")
  const [importOpen, setImportOpen] = React.useState(false)
  const [importText, setImportText] = React.useState("")
  const [importLoading, setImportLoading] = React.useState(false)
  const [importError, setImportError] = React.useState<string | null>(null)

  const fetchAccounts = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.get<{ accounts: SocialAccount[] }>("/api/accounts")
      setAccounts(data.accounts)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError("Не удалось загрузить аккаунты")
      }
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
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Удалить ${selectedIds.length} аккаунтов?`)) return
    try {
      await api.delete("/api/accounts/bulk", { ids: selectedIds })
      setSelectedIds([])
      fetchAccounts()
    } catch {
      setError("Ошибка удаления")
    }
  }

  const handleImport = async () => {
    if (!importText.trim()) return
    try {
      setImportLoading(true)
      setImportError(null)
      await api.post("/api/accounts/import", { raw: importText })
      setImportOpen(false)
      setImportText("")
      fetchAccounts()
    } catch (err) {
      if (err instanceof ApiError) {
        setImportError(err.message)
      } else {
        setImportError("Не удалось импортировать аккаунты")
      }
    } finally {
      setImportLoading(false)
    }
  }

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "сейчас"
    if (mins < 60) return `${mins} мин назад`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} ч назад`
    const days = Math.floor(hours / 24)
    return `${days} дн назад`
  }

  const renderStatus = (status: string) => {
    switch (status) {
      case "ALIVE":
        return <Badge variant="active" showDot>Живой</Badge>
      case "AUTH_NEEDED":
        return <Badge variant="warning" showDot>Нужна авториз.</Badge>
      case "BANNED":
        return <Badge variant="error" showDot>Бан</Badge>
      case "EXPIRED_COOKIES":
        return <Badge variant="error" showDot>Куки умерли</Badge>
      case "SHADOWBAN_SUSPECTED":
        return <Badge variant="warning" showDot>Теневой бан?</Badge>
      case "WARMING_UP":
        return <Badge variant="neutral" showDot>Прогрев</Badge>
      case "PAUSED":
        return <Badge variant="neutral" showDot>Пауза</Badge>
      default:
        return <Badge variant="neutral">{status}</Badge>
    }
  }

  const renderPlatform = (platform: string) => {
    return <span className="font-semibold">{platform === "TIKTOK" ? "TikTok" : "YouTube"}</span>
  }

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display-sm">Управление аккаунтами</h1>
          <p className="text-body-md text-text-muted">
            Всего: {accounts.length} аккаунтов
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary" onClick={fetchAccounts} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Синхронизировать
          </Button>
          <Button variant="primary" onClick={() => setImportOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-[#F43F5E]/10 text-[#F43F5E] border border-[#F43F5E]/20">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <Input
                placeholder="Поиск по юзернейму..."
                className="pl-10 h-10 bg-white/[0.02]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="relative">
            {loading && accounts.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-text-muted">
                <Loader2 className="w-6 h-6 animate-spin mr-3" />
                <span>Загрузка аккаунтов...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted">
                <span className="text-body-md">Аккаунты не найдены</span>
                <span className="text-caption mt-1">Попробуйте изменить поисковый запрос или добавьте аккаунты</span>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px] pl-6">
                      <Checkbox
                        checked={selectedIds.length === filtered.length && filtered.length > 0}
                        onChange={toggleAll}
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
                          onChange={() => toggleOne(acc.id)}
                          aria-label={`Select ${acc.username}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-3">
                          <Avatar size="md" />
                          <div>
                            <div className="font-medium text-white">{acc.username || "—"}</div>
                            <div className="text-caption text-text-muted">ID: {acc.id.slice(0, 8)}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{renderPlatform(acc.platform)}</TableCell>
                      <TableCell>{renderStatus(acc.status)}</TableCell>
                      <TableCell>
                        <div className="font-mono text-body-sm bg-white/5 px-2 py-1 rounded-sm inline-block">
                          {acc.pinnedProxy
                            ? `${acc.pinnedProxy.host}:${acc.pinnedProxy.port}`
                            : "—"}
                        </div>
                      </TableCell>
                      <TableCell>{(acc.followers ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-text-muted">{timeAgo(acc.updatedAt)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="w-4 h-4 text-text-muted" />
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
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 liquid-glass px-6 py-3 rounded-pill flex items-center space-x-4 border border-white/10"
                >
                  <span className="text-body-sm font-medium">Выбрано: {selectedIds.length}</span>
                  <div className="w-[1px] h-4 bg-white/10" />
                  <Button variant="ghost" size="sm" className="h-8 hover:text-white">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Обновить куки
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[#F43F5E] hover:text-[#FF1469] hover:bg-[#FF1469]/10"
                    onClick={handleDelete}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Удалить
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>
    </motion.div>

      {/* Import Modal */}
      <AnimatePresence>
        {importOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !importLoading && setImportOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-lg mx-4 liquid-glass rounded-2xl border border-white/10 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-display-xs">Импорт аккаунтов</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setImportOpen(false)}
                  disabled={importLoading}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <p className="text-body-sm text-text-muted mb-3">
                Вставьте данные аккаунтов в формате login:password или JSON с куками
              </p>

              <textarea
                className="w-full h-40 rounded-lg bg-white/[0.03] border border-white/10 p-3 text-body-sm font-mono text-white placeholder:text-text-muted focus:outline-none focus:border-white/20 resize-none"
                placeholder={"login:password\nlogin2:password2\n\nили JSON с куками..."}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                disabled={importLoading}
              />

              {importError && (
                <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-[#F43F5E]/10 text-[#F43F5E] text-body-sm border border-[#F43F5E]/20">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-4">
                <Button
                  variant="secondary"
                  onClick={() => setImportOpen(false)}
                  disabled={importLoading}
                >
                  Отмена
                </Button>
                <Button
                  variant="primary"
                  onClick={handleImport}
                  disabled={importLoading || !importText.trim()}
                >
                  {importLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Импорт...
                    </>
                  ) : (
                    "Импортировать"
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

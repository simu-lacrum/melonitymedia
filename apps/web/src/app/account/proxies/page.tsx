"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Plus, Trash2, Shield, SignalHigh, SignalMedium, SignalLow, Loader2, RefreshCw, X } from "lucide-react"
import { api, ApiError } from "@/lib/api"

interface Proxy {
  id: string
  host: string
  port: number
  type: string
  carrier?: string
  country?: string
  status: string
  latencyMs?: number
  _count?: { accounts: number }
}

export default function ProxiesPage() {
  const [proxies, setProxies] = React.useState<Proxy[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [search, setSearch] = React.useState("")
  const [showModal, setShowModal] = React.useState(false)
  const [modalMode, setModalMode] = React.useState<"single" | "bulk">("single")
  const [submitting, setSubmitting] = React.useState(false)

  // Single proxy form
  const [formHost, setFormHost] = React.useState("")
  const [formPort, setFormPort] = React.useState("")
  const [formUser, setFormUser] = React.useState("")
  const [formPass, setFormPass] = React.useState("")

  // Bulk import
  const [bulkText, setBulkText] = React.useState("")

  const fetchProxies = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.get<{ proxies: Proxy[] }>("/api/proxies")
      setProxies(data.proxies)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError("Не удалось загрузить прокси")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchProxies()
  }, [fetchProxies])

  const filtered = proxies.filter((p) =>
    `${p.host}:${p.port} ${p.carrier || ""} ${p.country || ""}`.toLowerCase().includes(search.toLowerCase())
  )

  const toggleAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filtered.map((p) => p.id))
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
    if (!confirm(`Удалить ${selectedIds.length} прокси?`)) return
    try {
      await api.post("/api/proxies/bulk-delete", { ids: selectedIds })
      setSelectedIds([])
      fetchProxies()
    } catch {
      setError("Ошибка удаления")
    }
  }

  const handleAddSingle = async () => {
    if (!formHost || !formPort) return
    setSubmitting(true)
    try {
      await api.post("/api/proxies", {
        host: formHost.trim(),
        port: parseInt(formPort, 10),
        username: formUser.trim() || undefined,
        password: formPass.trim() || undefined,
      })
      setShowModal(false)
      setFormHost("")
      setFormPort("")
      setFormUser("")
      setFormPass("")
      fetchProxies()
    } catch (err: any) {
      setError(err.message || "Ошибка добавления прокси")
    } finally {
      setSubmitting(false)
    }
  }

  const handleBulkImport = async () => {
    if (!bulkText.trim()) return
    setSubmitting(true)
    try {
      await api.post("/api/proxies/import", { raw: bulkText.trim() })
      setShowModal(false)
      setBulkText("")
      fetchProxies()
    } catch (err: any) {
      setError(err.message || "Ошибка импорта прокси")
    } finally {
      setSubmitting(false)
    }
  }

  const openModal = () => {
    setShowModal(true)
    setModalMode("single")
    setFormHost("")
    setFormPort("")
    setFormUser("")
    setFormPass("")
    setBulkText("")
  }

  const renderLatency = (ms?: number) => {
    if (!ms) return <span className="text-text-muted">—</span>
    if (ms < 100) return <div className="flex items-center text-[#00D287]"><SignalHigh className="w-4 h-4 mr-2" />{ms}ms</div>
    if (ms < 500) return <div className="flex items-center text-[#F59E0B]"><SignalMedium className="w-4 h-4 mr-2" />{ms}ms</div>
    return <div className="flex items-center text-[#F43F5E]"><SignalLow className="w-4 h-4 mr-2" />{ms}ms</div>
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display-sm">Управление прокси</h1>
          <p className="text-body-md text-text-muted">Всего: {proxies.length} прокси</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary" onClick={fetchProxies} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          <Button variant="primary" onClick={openModal}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить прокси
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-[#F43F5E]/10 text-[#F43F5E] border border-[#F43F5E]/20">
          {error}
        </div>
      )}

      {/* ── Add Proxy Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="liquid-glass p-8 w-full max-w-lg mx-4 relative"
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 text-text-muted hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-display-sm mb-6">Добавить прокси</h2>

            {/* Tabs */}
            <div className="flex space-x-2 mb-6">
              <button
                onClick={() => setModalMode("single")}
                className={`px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${
                  modalMode === "single"
                    ? "bg-melon-pink text-white"
                    : "bg-white/5 text-text-muted hover:text-white"
                }`}
              >
                Один прокси
              </button>
              <button
                onClick={() => setModalMode("bulk")}
                className={`px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${
                  modalMode === "bulk"
                    ? "bg-melon-pink text-white"
                    : "bg-white/5 text-text-muted hover:text-white"
                }`}
              >
                Массовый импорт
              </button>
            </div>

            {modalMode === "single" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="proxy-host">Хост *</Label>
                    <Input
                      id="proxy-host"
                      placeholder="185.0.0.1"
                      value={formHost}
                      onChange={(e) => setFormHost(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="proxy-port">Порт *</Label>
                    <Input
                      id="proxy-port"
                      placeholder="8080"
                      type="number"
                      value={formPort}
                      onChange={(e) => setFormPort(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="proxy-user">Логин</Label>
                    <Input
                      id="proxy-user"
                      placeholder="username"
                      value={formUser}
                      onChange={(e) => setFormUser(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="proxy-pass">Пароль</Label>
                    <Input
                      id="proxy-pass"
                      placeholder="password"
                      type="password"
                      value={formPass}
                      onChange={(e) => setFormPass(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={handleAddSingle}
                  disabled={submitting || !formHost || !formPort}
                >
                  {submitting ? "Добавление..." : "Добавить"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="proxy-bulk">Список прокси</Label>
                  <textarea
                    id="proxy-bulk"
                    rows={8}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-4 py-3 text-body-md text-white font-mono placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-melon-pink/50 resize-none"
                    placeholder={"host:port:user:pass\nhost:port:user:pass\nhost:port"}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                  />
                  <p className="text-caption text-text-muted mt-1">
                    Формат: host:port или host:port:user:pass — по одному на строку
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={handleBulkImport}
                  disabled={submitting || !bulkText.trim()}
                >
                  {submitting ? "Импорт..." : "Импортировать"}
                </Button>
              </div>
            )}
          </motion.div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <Input
                placeholder="Поиск по IP / Провайдеру..."
                className="pl-10 h-10 bg-white/[0.02]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            
            {selectedIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-[#F43F5E] hover:text-[#FF1469] hover:bg-[#FF1469]/10"
                onClick={handleDelete}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Удалить выбранные ({selectedIds.length})
              </Button>
            )}
          </div>

          {loading && proxies.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-text-muted">
              <Loader2 className="w-6 h-6 animate-spin mr-3" />
              <span>Загрузка прокси...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted">
              <span className="text-body-md">Прокси не найдены</span>
              <span className="text-caption mt-1">Добавьте прокси для работы с аккаунтами</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px] pl-6">
                    <Checkbox
                      checked={selectedIds.length === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>IP : Порт</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Оператор</TableHead>
                  <TableHead>Страна</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Задержка</TableHead>
                  <TableHead>Аккаунтов</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((proxy) => (
                  <TableRow key={proxy.id} data-state={selectedIds.includes(proxy.id) ? "selected" : undefined}>
                    <TableCell className="pl-6">
                      <Checkbox
                        checked={selectedIds.includes(proxy.id)}
                        onChange={() => toggleOne(proxy.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                          <Shield className="w-4 h-4 text-text-muted" />
                        </div>
                        <div className="font-mono text-body-md text-white">
                          {proxy.host}:{proxy.port}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">{proxy.type}</Badge>
                    </TableCell>
                    <TableCell>{proxy.carrier || "—"}</TableCell>
                    <TableCell>{proxy.country || "—"}</TableCell>
                    <TableCell>
                      {proxy.status === "ACTIVE" ? (
                        <Badge variant="active" showDot>Активен</Badge>
                      ) : proxy.status === "DEAD" ? (
                        <Badge variant="error" showDot>Мёртв</Badge>
                      ) : (
                        <Badge variant="warning" showDot>{proxy.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{renderLatency(proxy.latencyMs)}</TableCell>
                    <TableCell>{proxy._count?.accounts ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

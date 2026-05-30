"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Plus, Trash2, Shield, SignalHigh, SignalMedium, SignalLow, Loader2, RefreshCw } from "lucide-react"
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
      for (const id of selectedIds) {
        await api.delete(`/api/proxies/${id}`)
      }
      setSelectedIds([])
      fetchProxies()
    } catch {
      setError("Ошибка удаления")
    }
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
          <Button variant="primary">
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

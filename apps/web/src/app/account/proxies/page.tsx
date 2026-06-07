"use client"

import * as React from "react"
import { motion } from "framer-motion"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Plus, Trash2, Shield, SignalHigh, SignalMedium, SignalLow, Loader2, RefreshCw } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { toast } from "sonner"

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

interface LinkedAccount {
  id: string
  username: string
  platform: string
  pinnedProxyId?: string | null
}

export default function ProxiesPage() {
  const [proxies, setProxies] = React.useState<Proxy[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [search, setSearch] = React.useState("")
  const [showModal, setShowModal] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  const [formHost, setFormHost] = React.useState("")
  const [formPort, setFormPort] = React.useState("")
  const [formUser, setFormUser] = React.useState("")
  const [formPass, setFormPass] = React.useState("")
  const [bulkText, setBulkText] = React.useState("")

  const [linkedAccountsOpen, setLinkedAccountsOpen] = React.useState(false)
  const [linkedProxyId, setLinkedProxyId] = React.useState("")
  const [linkedAccounts, setLinkedAccounts] = React.useState<LinkedAccount[]>([])
  const [allAccounts, setAllAccounts] = React.useState<LinkedAccount[]>([])
  const [loadingLinked, setLoadingLinked] = React.useState(false)
  const [linkAccountId, setLinkAccountId] = React.useState("")

  const [bindAccountIds, setBindAccountIds] = React.useState<string[]>([])
  const [dialogAccounts, setDialogAccounts] = React.useState<LinkedAccount[]>([])

  const fetchProxies = React.useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.get<{ proxies: Proxy[] }>("/api/proxies")
      setProxies(data.proxies)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Не удалось загрузить прокси")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchProxies()
  }, [fetchProxies])

  React.useEffect(() => {
    if (showModal) {
      api.get<{ accounts: LinkedAccount[] }>("/api/accounts")
        .then(data => setDialogAccounts(data.accounts || []))
        .catch(() => {})
    }
  }, [showModal])

  const filtered = proxies.filter((p) =>
    `${p.host}:${p.port} ${p.carrier || ""} ${p.country || ""}`.toLowerCase().includes(search.toLowerCase())
  )

  const toggleAll = () => {
    setSelectedIds(selectedIds.length === filtered.length ? [] : filtered.map((p) => p.id))
  }

  const toggleOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleDelete = async () => {
    if (!confirm(`Удалить ${selectedIds.length} прокси?`)) return
    try {
      await api.post("/api/proxies/bulk-delete", { ids: selectedIds })
      toast.success(`Удалено ${selectedIds.length} прокси`)
      setSelectedIds([])
      fetchProxies()
    } catch {
      toast.error("Ошибка удаления")
    }
  }

  const handleAddSingle = async () => {
    if (!formHost || !formPort) return
    setSubmitting(true)
    try {
      // BUG-6 fix: Use the proxy ID from the creation response directly
      const result = await api.post<{ proxy: Proxy }>("/api/proxies", {
        host: formHost.trim(),
        port: parseInt(formPort, 10),
        username: formUser.trim() || undefined,
        password: formPass.trim() || undefined,
      })

      if (bindAccountIds.length > 0 && result.proxy?.id) {
        await Promise.all(
          bindAccountIds.map(accId =>
            api.patch(`/api/accounts/${accId}`, { pinnedProxyId: result.proxy.id }).catch(() => {})
          )
        )
      }

      toast.success("Прокси добавлен")
      setShowModal(false)
      setFormHost(""); setFormPort(""); setFormUser(""); setFormPass("")
      setBindAccountIds([])
      fetchProxies()
    } catch (err: any) {
      toast.error(err.message || "Ошибка добавления прокси")
    } finally {
      setSubmitting(false)
    }
  }

  const handleBulkImport = async () => {
    if (!bulkText.trim()) return
    setSubmitting(true)
    try {
      // BUG-12 fix: Use IDs returned by bulk import to distribute proxies across accounts
      const result = await api.post<{ created: number; ids: string[] }>("/api/proxies/import", { raw: bulkText.trim() })

      if (bindAccountIds.length > 0 && result.ids?.length > 0) {
        // Distribute proxies across accounts round-robin
        await Promise.all(
          bindAccountIds.map((accId, idx) => {
            const proxyId = result.ids[idx % result.ids.length]
            return api.patch(`/api/accounts/${accId}`, { pinnedProxyId: proxyId }).catch(() => {})
          })
        )
      }

      toast.success("Прокси импортированы")
      setShowModal(false)
      setBulkText("")
      setBindAccountIds([])
      fetchProxies()
    } catch (err: any) {
      toast.error(err.message || "Ошибка импорта прокси")
    } finally {
      setSubmitting(false)
    }
  }

  const handleShowLinked = async (proxyId: string) => {
    setLinkedProxyId(proxyId)
    setLinkedAccountsOpen(true)
    setLoadingLinked(true)
    try {
      const data = await api.get<{ accounts: LinkedAccount[] }>("/api/accounts")
      const all = data.accounts || []
      setAllAccounts(all)
      setLinkedAccounts(all.filter(a => a.pinnedProxyId === proxyId))
    } catch {
      toast.error("Ошибка загрузки аккаунтов")
    } finally {
      setLoadingLinked(false)
    }
  }

  const handleUnlinkAccount = async (accountId: string) => {
    try {
      await api.patch(`/api/accounts/${accountId}`, { pinnedProxyId: null })
      toast.success("Аккаунт отвязан")
      setLinkedAccounts(prev => prev.filter(a => a.id !== accountId))
      fetchProxies()
    } catch {
      toast.error("Ошибка")
    }
  }

  const handleLinkAccount = async () => {
    if (!linkAccountId) return
    try {
      await api.patch(`/api/accounts/${linkAccountId}`, { pinnedProxyId: linkedProxyId })
      toast.success("Аккаунт привязан")
      setLinkAccountId("")
      handleShowLinked(linkedProxyId)
      fetchProxies()
    } catch {
      toast.error("Ошибка привязки")
    }
  }

  const renderStatus = (status: string) => {
    if (status === "ACTIVE") return <Badge variant="default">Активен</Badge>
    if (status === "DEAD") return <Badge variant="destructive">Мёртв</Badge>
    return <Badge variant="outline">{status}</Badge>
  }

  const renderLatency = (ms?: number) => {
    if (!ms) return <span className="text-muted-foreground">—</span>
    const color = ms < 100 ? "text-green-500" : ms < 500 ? "text-yellow-500" : "text-destructive"
    const Icon = ms < 100 ? SignalHigh : ms < 500 ? SignalMedium : SignalLow
    return <div className={`flex items-center gap-1.5 ${color}`}><Icon className="size-4" />{ms}ms</div>
  }

  const renderAccountSelector = () => (
    <div className="flex flex-col gap-2">
      <Label>Привязать к аккаунтам (опционально)</Label>
      <div className="max-h-32 overflow-y-auto rounded-lg border border-border p-2 flex flex-col gap-1">
        {dialogAccounts.length === 0 ? (
          <span className="text-xs text-muted-foreground text-center py-2">Нет аккаунтов</span>
        ) : dialogAccounts.map(acc => (
          <label key={acc.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent/50 cursor-pointer text-sm transition-colors duration-150">
            <Checkbox
              checked={bindAccountIds.includes(acc.id)}
              onCheckedChange={(checked) => {
                setBindAccountIds(prev =>
                  checked ? [...prev, acc.id] : prev.filter(x => x !== acc.id)
                )
              }}
            />
            <span className="truncate flex-1">{acc.username || acc.id.slice(0, 8)}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {acc.platform === "TIKTOK" ? "TT" : "YT"}
            </Badge>
          </label>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Управление прокси</h1>
            <p className="text-sm text-muted-foreground mt-1">Всего: {proxies.length} прокси</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={fetchProxies} disabled={loading}>
              <RefreshCw className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Обновить
            </Button>
            <Button onClick={() => setShowModal(true)}>
              <Plus className="size-4 mr-2" />
              Добавить прокси
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по IP / Провайдеру..."
                  className="pl-10 bg-transparent"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {selectedIds.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleDelete}
                >
                  <Trash2 className="size-4 mr-2" />
                  Удалить ({selectedIds.length})
                </Button>
              )}
            </div>

            {loading && proxies.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="size-6 animate-spin mr-3" />
                <span>Загрузка прокси...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <span className="text-sm">Прокси не найдены</span>
                <span className="text-xs mt-1">Добавьте прокси для работы с аккаунтами</span>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px] pl-6">
                      <Checkbox
                        checked={selectedIds.length === filtered.length && filtered.length > 0}
                        onCheckedChange={toggleAll}
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
                          onCheckedChange={() => toggleOne(proxy.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-full bg-accent flex items-center justify-center">
                            <Shield className="size-4 text-muted-foreground" />
                          </div>
                          <code className="text-sm font-mono text-foreground">
                            {proxy.host}:{proxy.port}
                          </code>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="secondary">{proxy.type}</Badge></TableCell>
                      <TableCell className="text-sm">{proxy.carrier || "—"}</TableCell>
                      <TableCell className="text-sm">{proxy.country || "—"}</TableCell>
                      <TableCell>{renderStatus(proxy.status)}</TableCell>
                      <TableCell className="text-sm">{renderLatency(proxy.latencyMs)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs font-mono"
                          onClick={() => handleShowLinked(proxy.id)}
                        >
                          {proxy._count?.accounts ?? 0}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Add Proxy Dialog */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Добавить прокси</DialogTitle>
            <DialogDescription>Добавьте один прокси или импортируйте список</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="single">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="single">Один прокси</TabsTrigger>
              <TabsTrigger value="bulk">Массовый импорт</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="flex flex-col gap-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proxy-host">Хост *</Label>
                  <Input id="proxy-host" placeholder="185.0.0.1" value={formHost}
                    onChange={(e) => setFormHost(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proxy-port">Порт *</Label>
                  <Input id="proxy-port" placeholder="8080" type="number" value={formPort}
                    onChange={(e) => setFormPort(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proxy-user">Логин</Label>
                  <Input id="proxy-user" placeholder="username" value={formUser}
                    onChange={(e) => setFormUser(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proxy-pass">Пароль</Label>
                  <Input id="proxy-pass" placeholder="password" type="password" value={formPass}
                    onChange={(e) => setFormPass(e.target.value)} />
                </div>
              </div>
              {renderAccountSelector()}
              <Button onClick={handleAddSingle} disabled={submitting || !formHost || !formPort} className="w-full active:scale-[0.97] transition-transform">
                {submitting ? <><Loader2 className="size-4 mr-2 animate-spin" />Добавление...</> : "Добавить"}
              </Button>
            </TabsContent>

            <TabsContent value="bulk" className="flex flex-col gap-4 mt-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="proxy-bulk">Список прокси</Label>
                <Textarea
                  id="proxy-bulk"
                  rows={8}
                  className="font-mono text-sm resize-none"
                  placeholder={"host:port:user:pass\nhost:port:user:pass\nhost:port"}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Формат: host:port или host:port:user:pass — по одному на строку
                </p>
              </div>
              {renderAccountSelector()}
              <Button onClick={handleBulkImport} disabled={submitting || !bulkText.trim()} className="w-full active:scale-[0.97] transition-transform">
                {submitting ? <><Loader2 className="size-4 mr-2 animate-spin" />Импорт...</> : "Импортировать"}
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Linked Accounts Dialog */}
      <Dialog open={linkedAccountsOpen} onOpenChange={setLinkedAccountsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Привязанные аккаунты</DialogTitle>
            <DialogDescription>
              {linkedAccounts.length > 0 ? `${linkedAccounts.length} аккаунтов привязано` : "Нет привязанных аккаунтов"}
            </DialogDescription>
          </DialogHeader>
          {loadingLinked ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {linkedAccounts.map(acc => (
                <div key={acc.id} className="flex items-center justify-between p-2 rounded-md bg-accent/30">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {acc.platform === "TIKTOK" ? "TT" : "YT"}
                    </Badge>
                    <span className="text-sm">{acc.username || acc.id.slice(0, 8)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => handleUnlinkAccount(acc.id)}
                  >
                    Отвязать
                  </Button>
                </div>
              ))}

              <Separator className="my-2" />

              <div className="flex flex-col gap-2">
                <Label className="text-sm">Привязать аккаунт</Label>
                <Select value={linkAccountId} onValueChange={(v) => setLinkAccountId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Выберите аккаунт" /></SelectTrigger>
                  <SelectContent>
                    {allAccounts
                      .filter(a => !a.pinnedProxyId || a.pinnedProxyId !== linkedProxyId)
                      .map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.username || a.id.slice(0, 8)} ({a.platform === "TIKTOK" ? "TT" : "YT"})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleLinkAccount} disabled={!linkAccountId} className="active:scale-[0.97] transition-transform">
                  Привязать
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

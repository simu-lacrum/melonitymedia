"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Avatar } from "@/components/ui/avatar"
import { Search, Plus, Trash2, RefreshCw, MoreVertical } from "lucide-react"

const ACCOUNTS = [
  {
    id: "1",
    platform: "TIKTOK",
    username: "@arb_king_99",
    status: "ALIVE",
    proxy: "192.168.1.1:8080",
    followers: 12400,
    lastActive: "10 мин назад",
  },
  {
    id: "2",
    platform: "YOUTUBE",
    username: "shorts_master",
    status: "AUTH_NEEDED",
    proxy: "US-Mobile-1",
    followers: 450,
    lastActive: "2 часа назад",
  },
  {
    id: "3",
    platform: "TIKTOK",
    username: "@crypto_pump_xx",
    status: "BANNED",
    proxy: "Proxy-Dead",
    followers: 0,
    lastActive: "вчера",
  },
  {
    id: "4",
    platform: "YOUTUBE",
    username: "finance_guru",
    status: "WARMING_UP",
    proxy: "10.0.0.1:3128",
    followers: 12,
    lastActive: "сейчас",
  },
]

export default function AccountsPage() {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [search, setSearch] = React.useState("")

  const toggleAll = () => {
    if (selectedIds.length === ACCOUNTS.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(ACCOUNTS.map((a) => a.id))
    }
  }

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
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
      default:
        return <Badge variant="neutral">{status}</Badge>
    }
  }

  const renderPlatform = (platform: string) => {
    return <span className="font-semibold">{platform === "TIKTOK" ? "TikTok" : "YouTube"}</span>
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
          <h1 className="text-display-sm">Управление аккаунтами</h1>
          <p className="text-body-md text-text-muted">Всего: {ACCOUNTS.length} аккаунтов</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4 mr-2" />
            Синхронизировать
          </Button>
          <Button variant="primary">
            <Plus className="w-4 h-4 mr-2" />
            Добавить
          </Button>
        </div>
      </div>

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px] pl-6">
                    <Checkbox
                      checked={selectedIds.length === ACCOUNTS.length && ACCOUNTS.length > 0}
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
                {ACCOUNTS.map((acc) => (
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
                          <div className="font-medium text-white">{acc.username}</div>
                          <div className="text-caption text-text-muted">ID: {acc.id}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{renderPlatform(acc.platform)}</TableCell>
                    <TableCell>{renderStatus(acc.status)}</TableCell>
                    <TableCell>
                      <div className="font-mono text-body-sm bg-white/5 px-2 py-1 rounded-sm inline-block">
                        {acc.proxy}
                      </div>
                    </TableCell>
                    <TableCell>{acc.followers.toLocaleString()}</TableCell>
                    <TableCell className="text-text-muted">{acc.lastActive}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="w-4 h-4 text-text-muted" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            
            {/* Bulk Actions Bar */}
            <AnimatePresence>
              {selectedIds.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 liquid-glass-elevated px-6 py-3 rounded-pill flex items-center space-x-4 border border-white/10"
                >
                  <span className="text-body-sm font-medium">Выбрано: {selectedIds.length}</span>
                  <div className="w-[1px] h-4 bg-white/10" />
                  <Button variant="ghost" size="sm" className="h-8 hover:text-white">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Обновить куки
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 text-[#F43F5E] hover:text-[#FF1469] hover:bg-[#FF1469]/10">
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
  )
}

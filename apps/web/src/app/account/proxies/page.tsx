"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Plus, Trash2, Shield, Signal, SignalHigh, SignalMedium, SignalLow } from "lucide-react"

const PROXIES = [
  {
    id: "1",
    ip: "192.168.1.1",
    port: 8080,
    type: "MOBILE",
    provider: "AstroProxy",
    status: "ACTIVE",
    latency: 120,
    accountsLinked: 5,
  },
  {
    id: "2",
    ip: "10.0.0.1",
    port: 3128,
    type: "ISP",
    provider: "SpaceProxies",
    status: "ERROR",
    latency: 1500,
    accountsLinked: 2,
  },
  {
    id: "3",
    ip: "US-Mobile-1.proxy.net",
    port: 9000,
    type: "MOBILE",
    provider: "IPRoyal",
    status: "ACTIVE",
    latency: 45,
    accountsLinked: 12,
  },
]

export default function ProxiesPage() {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [search, setSearch] = React.useState("")

  const toggleAll = () => {
    if (selectedIds.length === PROXIES.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(PROXIES.map((p) => p.id))
    }
  }

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  const renderLatency = (ms: number) => {
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
          <p className="text-body-md text-text-muted">Всего: {PROXIES.length} прокси</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="primary">
            <Plus className="w-4 h-4 mr-2" />
            Добавить прокси
          </Button>
        </div>
      </div>

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
              <Button variant="ghost" size="sm" className="text-[#F43F5E] hover:text-[#FF1469] hover:bg-[#FF1469]/10">
                <Trash2 className="w-4 h-4 mr-2" />
                Удалить выбранные ({selectedIds.length})
              </Button>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px] pl-6">
                  <Checkbox
                    checked={selectedIds.length === PROXIES.length && PROXIES.length > 0}
                    onChange={toggleAll}
                  />
                </TableHead>
                <TableHead>IP : Порт</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Провайдер</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Задержка</TableHead>
                <TableHead>Аккаунтов</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PROXIES.map((proxy) => (
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
                        {proxy.ip}:{proxy.port}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{proxy.type}</Badge>
                  </TableCell>
                  <TableCell>{proxy.provider}</TableCell>
                  <TableCell>
                    {proxy.status === "ACTIVE" ? (
                      <Badge variant="active" showDot>Активен</Badge>
                    ) : (
                      <Badge variant="error" showDot>Ошибка</Badge>
                    )}
                  </TableCell>
                  <TableCell>{renderLatency(proxy.latency)}</TableCell>
                  <TableCell>{proxy.accountsLinked}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  )
}

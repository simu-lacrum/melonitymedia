import { Card, CardTitle } from '@/components/ui/Card';

export default function WorkspacePage() {
  return (
    <div>
      <h1 className="text-4xl mb-8 text-display-wide">Рабочая область</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Очередь контента</CardTitle>
          <p className="text-sm text-muted-gray mt-2">
            Загрузите видео и настройте параметры залива
          </p>
        </Card>

        <Card>
          <CardTitle>Терминал</CardTitle>
          <p className="text-sm text-muted-gray mt-2">
            Живой лог выполнения задач
          </p>
        </Card>
      </div>
    </div>
  );
}

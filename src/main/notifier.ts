import { Notification } from 'electron'
import type { Alarm } from '../shared/types'

/** 弹出系统通知；点击通知时执行 onActivate（用于显示并聚焦主窗口） */
export function showAlarmNotification(
  alarm: Alarm,
  onActivate: () => void
): void {
  if (!Notification.isSupported()) {
    return
  }
  const notification = new Notification({
    title: alarm.label,
    body: `提醒时间 ${alarm.time}`
  })
  notification.on('click', () => {
    onActivate()
  })
  notification.show()
}

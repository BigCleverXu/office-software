import { Notification } from 'electron'
import { formatPrice, formatPriceAlert } from '../shared/market'
import type { PriceAlert } from '../shared/market'
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

/** 弹出价格提醒系统通知；点击时执行 onActivate（显示窗口并切到行情页） */
export function showPriceAlertNotification(
  alert: PriceAlert,
  price: number,
  onActivate: () => void
): void {
  if (!Notification.isSupported()) {
    return
  }
  const name = alert.name || alert.symbol
  const condition = formatPriceAlert(alert)
  const notification = new Notification({
    title: `${name} 触发价格提醒`,
    body: `现价 ${formatPrice(price)}，已满足 ${condition}`
  })
  notification.on('click', () => {
    onActivate()
  })
  notification.show()
}

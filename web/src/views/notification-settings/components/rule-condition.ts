import { type AlertRule, metricLabels } from '@/api/alerts';

export function ruleCondition(rule: AlertRule, includeMetric = false) {
  if (rule.metric === 'offline') return `持续离线 ${rule.window_minutes} 分钟`;
  if (rule.metric === 'monthly') {
    return `${includeMetric ? '月流量用量' : '用量'} ≥ ${rule.threshold} ${rule.mode === 'gb' ? 'GB' : '%'}`;
  }
  const metric = includeMetric ? metricLabels[rule.metric] : '';
  const samples = rule.mode === 'all' ? '所有样本' : '平均值';
  const unit = rule.metric === 'upload' || rule.metric === 'download' ? 'MB/s' : '%';
  return `${rule.window_minutes} 分钟内${metric}${samples} > ${rule.threshold} ${unit}`;
}

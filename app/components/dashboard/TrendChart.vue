<script setup lang="ts">
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { formatMoneyCompact } from '../../lib/format'

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const props = withDefaults(
  defineProps<{
    labels: string[]
    income?: string[]
    expense?: string[]
    net?: string[]
    height?: string
  }>(),
  { income: () => [], expense: () => [], net: () => [], height: '280px' },
)

const el = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function render(): void {
  if (!el.value) return
  chart ??= echarts.init(el.value)
  const toNum = (values: string[]): number[] =>
    values.map((v) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
    })
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number) => formatMoneyCompact(value),
      borderColor: '#27272a',
      backgroundColor: '#18181b',
      textStyle: { color: '#e4e4e7' },
    },
    legend: {
      textStyle: { color: '#a1a1aa', fontSize: 11 },
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
    },
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: props.labels,
      axisLine: { lineStyle: { color: '#27272a' } },
      axisLabel: { color: '#71717a', fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#27272a' } },
      axisLabel: { color: '#71717a', fontSize: 10, formatter: (v: number) => formatMoneyCompact(v) },
    },
    series: [
      ...(props.income.length
        ? [
            {
              name: 'Income',
              type: 'bar' as const,
              data: toNum(props.income),
              itemStyle: { color: '#34d399', borderRadius: [3, 3, 0, 0] },
              barMaxWidth: 18,
            },
          ]
        : []),
      ...(props.expense.length
        ? [
            {
              name: 'Expense',
              type: 'bar' as const,
              data: toNum(props.expense),
              itemStyle: { color: '#f87171', borderRadius: [3, 3, 0, 0] },
              barMaxWidth: 18,
            },
          ]
        : []),
      ...(props.net.length
        ? [
            {
              name: 'Net cashflow',
              type: 'line' as const,
              data: toNum(props.net),
              smooth: true,
              symbolSize: 5,
              lineStyle: { color: '#818cf8', width: 2 },
              itemStyle: { color: '#818cf8' },
            },
          ]
        : []),
    ],
  })
}

function onResize(): void {
  chart?.resize()
}

onMounted(() => {
  render()
  window.addEventListener('resize', onResize)
})

watch(
  () => [props.labels, props.income, props.expense, props.net],
  () => render(),
  { deep: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="el" :style="{ height }" aria-label="Cashflow chart" />
</template>

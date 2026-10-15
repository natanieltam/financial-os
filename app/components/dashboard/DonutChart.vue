<script setup lang="ts">
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { formatMoneyCompact } from '../../lib/format'

echarts.use([PieChart, TooltipComponent, CanvasRenderer])

interface Slice {
  name: string
  value: number
}

const props = defineProps<{ slices: Slice[]; height?: string }>()

const el = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const COLORS = ['#818cf8', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#a78bfa', '#fb923c', '#4ade80']

function render(): void {
  if (!el.value) return
  chart ??= echarts.init(el.value)
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}: ${formatMoneyCompact(p.value)} (${p.percent}%)`,
      borderColor: '#27272a',
      backgroundColor: '#18181b',
      textStyle: { color: '#e4e4e7' },
    },
    series: [
      {
        type: 'pie',
        radius: ['62%', '88%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#09090b', borderWidth: 2, borderRadius: 3 },
        label: {
          color: '#a1a1aa',
          fontSize: 10,
          formatter: (p: { name: string; percent: number }) => `${p.name} ${p.percent}%`,
        },
        labelLine: { lineStyle: { color: '#3f3f46' } },
        data: props.slices.map((s, i) => ({ ...s, itemStyle: { color: COLORS[i % COLORS.length] } })),
      },
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

watch(() => props.slices, () => render(), { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="el" :style="{ height: height ?? '240px' }" aria-label="Distribution chart" />
</template>

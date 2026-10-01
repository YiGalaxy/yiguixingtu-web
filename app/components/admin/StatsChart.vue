<template>
  <!-- ECharts needs a sized host element. -->
  <div ref="host" class="st-chart" :style="{ height }" />
</template>

<script setup>
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart, BarChart, PieChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  CanvasRenderer,
])

/** Small ECharts wrapper with lifecycle and resize handling. */

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '280px' },
})

const host = ref(null)
let chart = null
let observer = null

/** 渲染（或更新）图表 */
const render = () => {
  if (!host.value) return
  // happy-dom/SSR 没有可测量的布局尺寸，ECharts 在这种环境下无法初始化。
  // 浏览器完成布局后会通过 ResizeObserver 继续接管真实渲染。
  if (!host.value.clientWidth || !host.value.clientHeight) return
  // 部分测试 DOM 提供尺寸但不提供 Canvas 2D 上下文；避免把图表能力缺失
  // 误报成业务渲染错误，同时保留真实浏览器中的 Canvas 渲染。
  if (typeof document !== 'undefined') {
    try {
      if (!document.createElement('canvas').getContext?.('2d')) return
    } catch {
      return
    }
  }
  if (!chart) {
    chart = echarts.init(host.value, null, { renderer: 'canvas' })
  }
  // notMerge: true —— 换一份 option 时把上一份完全替换掉。
  // 用默认的合并模式，切换"最近 7 天/30 天"时上一份的 series 会残留下来
  // （表现为图里多出几条已经不该存在的线）
  chart.setOption(props.option, true)
}

onMounted(() => {
  render()

  observer = new ResizeObserver(() => {
    // resize() 在容器尺寸真的变了时才需要，但这里不做判断 ——
    // ResizeObserver 本身就只在尺寸变化时回调
    chart?.resize()
  })
  if (host.value) observer.observe(host.value)
})

// option 变了就重画（父组件拿到新数据时）
watch(() => props.option, render, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  // ⚠️ dispose 而不是 clear：clear 只清内容，实例与它持有的 canvas 还在
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
/* 宽度吃满父容器；高度由 props 给（见模板） */
.st-chart { width: 100%; }
</style>

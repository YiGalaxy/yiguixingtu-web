<template>
  <!-- 图表的容器。ECharts 需要一个有确定尺寸的 DOM 元素来挂 canvas ——
       高度由父级通过 height 传进来（不给高度的话它初始化出来是 0 高，
       表现为"图不见了"，而且控制台什么都不会说）。 -->
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

/**
 * =====================================================================
 * ECharts 的薄封装（后台统计页专用）
 *
 * 【为什么要封一层，而不是在面板里直接调 echarts.init】
 *   图表库有两件必须自己管的东西，散在业务组件里迟早漏一个：
 *     · **销毁**：ECharts 实例持有 canvas 与事件监听，不 dispose 就泄漏。
 *       后台面板是"切菜单就销毁重建"的（v-if），漏一次就多一个实例
 *     · **窗口尺寸变化**：不及时 resize 的话，图会保持旧宽度 ——
 *       最典型的表现是"缩小窗口后右侧被裁掉一截"
 *   封一层之后，业务组件只负责"给我一个 option"。
 *
 * 【按需引入（echarts/core）】只注册用到的图表与组件。
 *   全量 import * as echarts from 'echarts' 会把所有图表类型都打进包里
 *   （几百 KB），而这个页面只用得到折线、柱状、饼图三种。
 *
 * 【为什么用 ResizeObserver 而不是监听 window.resize】
 *   后台的侧边栏是固定宽度、内容区随窗口变；但将来若加了可折叠的侧栏，
 *   窗口没变而容器变了 —— 那时 window.resize 收不到通知，图就会错位。
 *   ResizeObserver 盯的是容器自己，两种情况都对。
 * =====================================================================
 */

const props = defineProps({
  /** 完整的 ECharts option（由调用方按数据拼好，这里不做任何业务解释） */
  option: { type: Object, required: true },
  /** 容器高度，CSS 值（图表必须有确定高度，见模板注释） */
  height: { type: String, default: '280px' },
})

const host = ref(null)
let chart = null
let observer = null

/** 渲染（或更新）图表 */
const render = () => {
  if (!host.value) return
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

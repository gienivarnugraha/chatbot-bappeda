<template>
    <Bar :chart-data="chartData" :chart-options="chartOptions" />
</template>

<script>
import { defineComponent } from 'vue';
import { Bar } from 'vue-chart-3';
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

export default defineComponent({
    name: 'BarChart',
    components: { Bar },
    props: {
        chartData: {
            type: Object,
            required: true
        },
        chartOptions: {
            type: Object,
            default: () => ({})
        }
    }
});
</script>
<template>
    <component :is="chartType" :chart-data="data" :chart-options="options" />
</template>

<script>
import { defineComponent, ref } from 'vue';
import BarChart from './BarChart.vue';
import LineChart from './LineChart.vue';

export default defineComponent({
    name: 'ChartSwitcher',
    components: {
        BarChart,
        LineChart
    },
    setup() {
        const chartType = ref('BarChart');

        // Sample data shared by all chart types
        const data = ref({
            labels: ['January', 'February', 'March', 'April', 'May'],
            datasets: [
                {
                    label: 'Dataset 1',
                    data: [65, 59, 80, 81, 56],
                    backgroundColor: 'rgba(75, 192, 192, 0.5)',
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1
                },
            ]
        });

        const options = ref({
            responsive: true,
            maintainAspectRatio: false,
        });

        return {
            currentChart,
            data,
            options
        };
    }
});
</script>
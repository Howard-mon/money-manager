<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
  <RouterView />
</template>

<style lang="scss" scoped>
:global(body) {
  margin: 0;
  background: #0d121a;
  color: #edf3ed;
  font-family: 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif;
}

:global(*) { box-sizing: border-box; }
</style>

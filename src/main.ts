import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import element from "element-plus";
import "element-plus/theme-chalk/index.css";

createApp(App).use(router).use(element).mount("#app");

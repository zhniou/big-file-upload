<template>
  <div>
    <div>
      <input type="file" @change="handleFileChange" />
      <el-button @click="handleUpload">上传</el-button>
      <el-button @click="handlePause">暂停</el-button>
      <el-button @click="handleResume">继续</el-button>

      <div style="text-align: left">
        <span>哈希进度</span>
        <el-progress :percentage="hashPercentage"></el-progress>
      </div>

      <div style="text-align: left">
        <span>上传进度</span>
        <el-progress :percentage="fakeUploadPercentage"></el-progress>
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import { ref, computed, watch } from "vue";
import { request } from "../api/request.js";
export default {
  setup() {
    /**
     * 接受文件类型
     */
    const allowType = {
      "video/mp4": "mp4",
      "video/ogg": "ogg",
      "application/zip": "zip",
    };
    const container = {
      file: null,
      hash: "",
      worker: null,
    };

    // 切片大小
    const SIZE = 10 * 1024 * 1024;
    let hashPercentage = ref(0); //生成hash进度
    let fakeUploadPercentage = ref(0); //上传进度
    let data = ref([]);
    let XMLHttpRequestList = ref([]);
    const reset = () => {
      hashPercentage.value = 0;
      fakeUploadPercentage.value = 0;
    };

    /**
     * 选择文件
     */
    const handleFileChange = (e) => {
      const [file] = e.target.files;
      if (!file) return;
      if (!allowType[file.type]) {
        console.log("不支持该类型文件上传！");
        return;
      }
      container.file = file;
    };

    // 生成文件切片
    const createFileChunk = (file, size = SIZE) => {
      const fileChunkList = [];
      let cur = 0;
      while (cur < file.size) {
        fileChunkList.push({ file: file.slice(cur, cur + size) });
        cur += size;
      }
      return fileChunkList;
    };

    // 生成文件 hash
    const calculateHash = (fileChunkList) => {
      return new Promise((resolve) => {
        container.worker = new Worker("/hash.js");
        //发送信息到worker进程
        container.worker.postMessage({ fileChunkList });
        // 监听接收worker进程信息
        container.worker.onmessage = (e) => {
          const { percentage, hash } = e.data;
          hashPercentage.value = percentage;
          if (hash) {
            resolve(hash);
          }
        };
      });
    };

    /**
     * 验证是否满足上传条件
     */
    const verifyUpload = async (filename, fileHash) => {
      const { data } = await request({
        url: "http://localhost:3000/verify",
        headers: {
          "content-type": "application/json",
        },
        data: JSON.stringify({
          filename,
          fileHash,
        }),
      });
      return JSON.parse(data.responseText);
    };

    /**
     * 开始上传
     */
    const handleUpload = async () => {
      if (!container.file) return;

      reset();

      // 文件切片
      const fileChunkList = createFileChunk(container.file);
      console.log(fileChunkList, "fileChunkList");

      // 生成文件hash
      container.hash = (await calculateHash(fileChunkList)) as string;

      // 验证
      const { shouldUpload, uploadedList } = await verifyUpload(
        container.file.name,
        container.hash
      );

      if (!shouldUpload) {
        return;
      }

      data.value = fileChunkList.map(({ file }, index) => ({
        fileHash: container.hash,
        index,
        hash: container.hash + "-" + index,
        chunk: file,
        size: file.size,
        percentage: uploadedList.includes(index) ? 100 : 0,
      }));
      await uploadChunks(uploadedList);
    };

    // 上传切片
    const uploadChunks = async (uploadedList = []) => {
      const requestList = data.value
        .filter(({ hash }) => !uploadedList.includes(hash))
        .map(({ chunk, hash, index }) => {
          const formData = new FormData();
          formData.append("chunk", chunk);
          formData.append("hash", hash);
          formData.append("filename", container.file.name);
          formData.append("fileHash", container.hash);
          return { formData, index };
        })
        .map(({ formData, index }) =>
          request({
            url: "http://localhost:3000",
            data: formData,
            onProgress: createProgressHandler(data.value[index]),
            requestList: XMLHttpRequestList.value,
          })
        );
      await Promise.all(requestList);
      // 之前上传的切片数量 + 本次上传的切片数量 = 所有切片数量时合并切片
      if (uploadedList.length + requestList.length === data.value.length) {
        await mergeRequest();
      }
    };

    // 通知服务端合并切片
    const mergeRequest = async () => {
      await request({
        url: "http://localhost:3000/merge",
        headers: {
          "content-type": "application/json",
        },
        data: JSON.stringify({
          size: SIZE,
          fileHash: container.hash,
          filename: container.file.name,
        }),
      });
      console.log("upload success, check /target directory");
    };

    // 保存每个 chunk 的进度数据
    const createProgressHandler = (item) => {
      return (e) => {
        item.percentage = parseInt(String((e.loaded / e.total) * 100));
      };
    };

    // 进度
    const uploadPercentage = computed(() => {
      if (!data.value.length) return 0;
      const loaded = data.value
        .map((item) => item.size * item.percentage)
        .reduce((acc, cur) => acc + cur);
      return parseInt((loaded / container.file.size).toFixed(2));
    });

    watch(uploadPercentage, (now) => {
      if (now > fakeUploadPercentage.value) {
        fakeUploadPercentage.value = now;
      }
    });

    /**
     * 暂停文件发送
     */
    const resetData = async () => {
      XMLHttpRequestList.value.forEach((xhr) => xhr.abort());
      XMLHttpRequestList.value = [];
      if (container.worker) {
        container.worker.onmessage = null;
      }
    };

    const handlePause = () => {
      resetData();
    };

    /**
     * 继续上传
     */
    const handleResume = async () => {
      const { uploadedList } = await verifyUpload(
        container.file.name,
        container.hash
      );
      await uploadChunks(uploadedList);
    };

    return {
      handleFileChange,
      handleUpload,
      hashPercentage,
      fakeUploadPercentage,
      handlePause,
      handleResume,
    };
  },
};
</script>

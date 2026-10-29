import { initializeStore } from "../shared/store";

chrome.runtime.onInstalled.addListener(() => {
  void initializeStore();
});

self.onmessage = function(e) {
  const { action, data } = e.data;
  try {
    let result;
    if (action === 'stringify') {
      result = JSON.stringify(data.value, data.replacer, data.space);
    } else if (action === 'parse') {
      result = JSON.parse(data.text);
    }
    self.postMessage({ success: true, result });
  } catch (error) {
    self.postMessage({ success: false, error: error.message });
  }
};
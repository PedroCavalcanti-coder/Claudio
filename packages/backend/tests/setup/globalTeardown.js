'use strict';
module.exports = async () => {
  if (global.__FAKE_S3__) await global.__FAKE_S3__.close();
};

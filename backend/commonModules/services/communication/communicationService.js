const {
  sendEmailViaSgrid,
  sendEmailViaAwsSes,
  sendSmsViaPinpoint,
  sendEmailViaBrevo,
} = require("@utils/emailUtil");
const { Devices } = require("@models/Devices");
const adminFireBConfig = require("@config/firebaseAdmin");
const { NotificationExp } = require("@models/Notifications");
const { Vonage } = require("@vonage/server-sdk");
const axios = require("axios");
const { AppError } = require("@services/_errors/AppError");

const vonage = new Vonage({
  apiKey: "ec823766",
  apiSecret: "KNMQzSzi9eJx93mF",
});

const wrapProviderError = (error, fallbackKey = "an_error_9") => {
  if (error instanceof AppError) return error;
  return new AppError(error.body || error.message || fallbackKey, 500);
};

const sendEmailSgrid = async ({ title, emails, subject, body, config }) => {
  try {
    await sendEmailViaSgrid(title, emails, subject, body, config);
  } catch (error) {
    throw wrapProviderError(error);
  }
};

const sendEmailAws = async ({ emails, subject, body, config }) => {
  try {
    await sendEmailViaAwsSes(emails, subject, body, config);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("failed_to", 500);
  }
};

const sendEmailBrevo = async ({ emails, subject, body, config }) => {
  try {
    await sendEmailViaBrevo(emails, subject, body, config);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("failed_to", 500);
  }
};

const sendSmsViaPinpointAws = async ({ phoneNumber, otp }) => {
  try {
    const otpMessage = `${otp} is your OTP for the Tempy Hub`;
    await sendSmsViaPinpoint(phoneNumber, otpMessage);
  } catch (error) {
    throw wrapProviderError(error);
  }
};

const sendNotification = async (recipients, payload) => {
  const androidTokens = [];
  const iosTokens = [];

  recipients.forEach((recipient) => {
    if (recipient.deviceType === "android") {
      androidTokens.push(recipient.deviceId);
    } else if (recipient.deviceType === "ios") {
      iosTokens.push(recipient.deviceId);
    }
  });

  const androidPayload = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data,
  };

  const iosPayload = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    apns: {
      payload: {
        aps: {
          alert: {
            title: payload.title,
            body: payload.body,
          },
          sound: "default",
          badge: 1,
        },
      },
    },
    data: payload.data,
  };

  try {
    const promises = [];

    if (androidTokens.length > 0) {
      promises.push(
        adminFireBConfig.messaging().sendEachForMulticast({
          tokens: androidTokens,
          ...androidPayload,
        })
      );
    }

    if (iosTokens.length > 0) {
      promises.push(
        adminFireBConfig.messaging().sendEachForMulticast({
          tokens: iosTokens,
          ...iosPayload,
        })
      );
    }

    const responses = await Promise.all(promises);
    const result = { responses: [] };
    responses.forEach((response) => {
      result.responses = result.responses.concat(response.responses);
    });
    return result;
  } catch (error) {
    console.error("Error sending notifications:", error);
    throw error;
  }
};

const sendNotificationForTesting = async ({ recipients, title, body, data }) => {
  try {
    const response = await sendNotification(recipients, {
      title,
      body,
      data,
    });

    const successIds = [];
    const failureIds = [];

    response.responses.forEach((resp, idx) => {
      if (resp.success) {
        successIds.push(recipients[idx]);
      } else {
        failureIds.push({
          ...recipients[idx],
          error: resp.error ? resp.error.message : "Unknown error",
        });
      }
    });

    const payload = { successIds, failureIds };

    if (successIds.length > 0) {
      return {
        statusCode: 200,
        translationKey: "notifications_sent_success",
        values: { title },
        data: payload,
      };
    }

    const failure = new AppError("notifications_sent_failure", 500, { title });
    failure.data = payload;
    throw failure;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(error.message, 500);
  }
};

const sendUserNotifications = async ({
  recipientIds,
  title,
  body,
  data = {},
  sender = null,
  objectId = null,
  saveNotification = true,
}) => {
  setImmediate(async () => {
    try {
      const recipientDevices = await Devices.find({
        userId: { $in: recipientIds },
      }).select("userId devices");

      if (recipientDevices && recipientDevices.length > 0) {
        const flattenedDevices = recipientDevices.flatMap((userDevice) =>
          userDevice.devices.map((device) => ({
            userId: userDevice.userId,
            deviceId: device.deviceId,
            deviceType: device.deviceType,
          }))
        );

        const devicesByUser = flattenedDevices.reduce((acc, device) => {
          if (!acc[device.userId]) {
            acc[device.userId] = new Set();
          }
          acc[device.userId].add(device);
          return acc;
        }, {});

        const responses = [];

        for (const userId in devicesByUser) {
          const userDevices = Array.from(devicesByUser[userId]).map(
            (device) => ({
              deviceId: device.deviceId,
              deviceType: device.deviceType,
            })
          );

          const sendNotificationResponse = await sendNotification(userDevices, {
            title,
            body,
            data: {
              ...data,
              subjectId: sender ? sender.toString() : null,
              objectId: objectId.toString(),
            },
          });
          responses.push({ userId, sendNotificationResponse });
        }

        console.log(data);

        responses.forEach((response) => {
          console.log(
            `Response for user ${response.userId}:`,
            JSON.stringify(response.sendNotificationResponse, null, 2)
          );
        });

        if (!saveNotification) {
          return;
        }

        const notificationsToSave = responses.map(({ userId }) => ({
          type: data.type || "system",
          subjectId: sender,
          objectId: objectId,
          objectType: data.objectType,
          receiverId: userId,
          title,
          body,
        }));

        await NotificationExp.insertMany(notificationsToSave);
      } else {
        console.log("No devices found for the provided user IDs.");
      }
    } catch (error) {
      console.error("Error sending notifications in background:", error);
    }
  });
};

const sendSmsViaVonage = async ({ phoneNumber, otp }) => {
  try {
    const otpMessage = `${otp} is your OTP for the ZahraPay App`;
    const from = "+923005098444";
    const messageData = {
      to: phoneNumber,
      from,
      text: otpMessage,
    };

    const responseData = await new Promise((resolve, reject) => {
      vonage.sms.send(messageData, (err, data) => {
        if (err) {
          console.error("Error sending SMS:", err);
          reject(new AppError("Error sending SMS via Vonage", 500));
          return;
        }
        resolve(data);
      });
    });

    console.log("Response data:", responseData);
    if (
      responseData &&
      responseData.messages &&
      responseData.messages[0].status === "0"
    ) {
      console.log("Message sent successfully:", responseData);
      return responseData;
    }

    console.error(
      "Failed to send message. Status:",
      responseData.messages[0].status
    );
    const failure = new AppError("otp_sent", 500);
    failure.cause = `Failed with status: ${responseData.messages[0].status}`;
    throw failure;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Error sending SMS:", error);
    throw new AppError(error.message || "otp_sent", 500);
  }
};

const sendSMSSomalianAPI = async ({ phoneNumber, otp }) => {
  const message = `Your OTP is ${otp}`;

  try {
    const apiKey = "07098f01-6071-4045-abd8-63a7ec3e25ac";
    const apiSecret = "5810f9db-bd8e-4002-ab57-721ab0d8ee1e";
    const accountApiCredentials = `${apiKey}:${apiSecret}`;
    const buff = Buffer.from(accountApiCredentials);
    const base64Credentials = buff.toString("base64");

    const requestHeaders = {
      headers: {
        Authorization: `Basic ${base64Credentials}`,
        "Content-Type": "application/json",
      },
    };

    const requestData = JSON.stringify({
      messages: [
        {
          content: message,
          destination: phoneNumber,
        },
      ],
    });

    const response = await axios.post(
      "https://rest.mymobileapi.com/bulkmessages",
      requestData,
      requestHeaders
    );

    if (response.data) {
      console.log("Success:", response.data);
      return response.data;
    }
  } catch (error) {
    console.error("Error sending SMS:", error);
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || "otp_sent", 500);
  }
};

module.exports = {
  sendEmailSgrid,
  sendEmailAws,
  sendEmailBrevo,
  sendSmsViaPinpointAws,
  sendNotificationForTesting,
  sendUserNotifications,
  sendNotification,
  sendSmsViaVonage,
  sendSMSSomalianAPI,
};

const incomingMailService = require("../incoming-mail/incomingMail.service");
const outgoingMailService = require("../outgoing-mails/outgoingMails.service");
const memorandumService = require("../memorandum/memorandum.service");

exports.findIncomingMails = (args) => incomingMailService.getIncomingMails(args);

exports.findOutgoingMails = (args) => outgoingMailService.getAll(args);

exports.findMemorandums = (args) => memorandumService.getMemorandums(args);

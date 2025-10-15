const {
  AffectedTaskOccurrence,
  BasePropertySet,
  BodyType,
  ConnectingIdType,
  DeleteMode,
  EmailMessageSchema,
  ExchangeService,
  ExchangeVersion,
  ImpersonatedUserId,
  ItemTraversal,
  ItemView,
  PropertySet,
  SortDirection,
  Uri,
  WebCredentials,
  WellKnownFolderName,
  SendCancellationsMode
} = require("ews-javascript-api");
const createError = require("http-errors");
const PQueue = require("p-queue").default;

const { buildAqsQuery } = require("../utils/queryBuilder");
const logger = require("../utils/logger");

const SERVICE_VERSION_MAP = {
  exchange2010: ExchangeVersion.Exchange2010_SP2,
  exchange2013: ExchangeVersion.Exchange2013,
  exchange2016: ExchangeVersion.Exchange2016,
  exchange2019: ExchangeVersion.Exchange2019
};

const DELETE_MODE_MAP = {
  softdelete: DeleteMode.SoftDelete,
  movetodeleteditems: DeleteMode.MoveToDeletedItems,
  harddelete: DeleteMode.HardDelete
};

const FOLDER_MAP = {
  inbox: WellKnownFolderName.Inbox,
  junkemail: WellKnownFolderName.JunkEmail,
  deleteditems: WellKnownFolderName.DeletedItems,
  sentitems: WellKnownFolderName.SentItems,
  drafts: WellKnownFolderName.Drafts,
  archive: WellKnownFolderName.ArchiveRoot
};

const coerceInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const parseList = (value, fallback) => {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const config = {
  ewsUrl: process.env.EWS_URL,
  autodiscoverEmail: process.env.EWS_AUTODISCOVER_EMAIL,
  username: process.env.EWS_USERNAME,
  password: process.env.EWS_PASSWORD,
  domain: process.env.EWS_DOMAIN,
  version: (process.env.EWS_VERSION || "Exchange2016").toLowerCase(),
  ignoreSsl: process.env.EWS_IGNORE_SSL === "true",
  defaultFolders: parseList(process.env.DEFAULT_FOLDERS, ["Inbox", "JunkEmail"]),
  maxPerMailbox: Math.max(1, coerceInteger(process.env.DEFAULT_MAX_RESULTS, 200)),
  pageSize: Math.max(1, Math.min(coerceInteger(process.env.EWS_PAGE_SIZE, 50), 200)),
  maxConcurrency: Math.max(1, coerceInteger(process.env.EWS_MAX_CONCURRENCY, 4))
};

const mergeContext = (context = {}, extra = {}) => ({ ...context, ...extra });

const sanitizeServiceConfig = () => ({
  ewsUrl: config.ewsUrl,
  autodiscoverEmail: config.autodiscoverEmail,
  username: config.username,
  domain: config.domain,
  version: config.version,
  ignoreSsl: config.ignoreSsl
});

const wrapExchangeError = (message, error, details = {}, status = 502) => {
  const wrapped = createError(status, message);
  wrapped.details = details;
  wrapped.cause = error;
  wrapped.expose = true;
  return wrapped;
};

const ensureCredentialsConfigured = () => {
  if (!config.username || !config.password) {
    const missing = [];
    if (!config.username) missing.push("EWS_USERNAME");
    if (!config.password) missing.push("EWS_PASSWORD");

    const error = createError(500, "EWS credentials are not configured");
    error.details = { missing };
    error.expose = true;
    throw error;
  }
};

const resolveServiceVersion = () => SERVICE_VERSION_MAP[config.version] || ExchangeVersion.Exchange2016;

const createService = async (context = {}) => {
  ensureCredentialsConfigured();

  if (!config.ewsUrl && !config.autodiscoverEmail) {
    const error = createError(500, "Either EWS_URL or EWS_AUTODISCOVER_EMAIL must be supplied in the environment.");
    error.details = { operation: "configuration" };
    error.expose = true;
    throw error;
  }

  if (config.ignoreSsl) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const operation = context.operation || "ExchangeService";
  const sanitized = sanitizeServiceConfig();

  try {
    const service = new ExchangeService(resolveServiceVersion());

    if (config.domain) {
      service.Credentials = new WebCredentials(config.username, config.password, config.domain);
    } else {
      service.Credentials = new WebCredentials(config.username, config.password);
    }

    if (config.ewsUrl) {
      service.Url = new Uri(config.ewsUrl);
    } else if (config.autodiscoverEmail) {
      await service.AutodiscoverUrl(
        config.autodiscoverEmail,
        (url) => url && url.toLowerCase().startsWith("https://")
      );
    }

    logger.debug({ requestId: context.requestId, operation, config: sanitized }, "Exchange service initialised");
    return service;
  } catch (error) {
    logger.error(
      { error, requestId: context.requestId, operation, config: sanitized },
      "Failed to initialise Exchange service"
    );
    throw wrapExchangeError("Failed to initialise Exchange Web Services client", error, {
      ...sanitized,
      operation
    });
  }
};

const ensureFolder = (folder) => {
  const normalized = folder.toLowerCase();
  const resolved = FOLDER_MAP[normalized];

  if (!resolved) {
    const error = createError(400, `Unsupported folder specified: ${folder}`);
    error.expose = true;
    throw error;
  }

  return { name: folder, id: resolved };
};

const resolveFolders = (folders) => {
  const targetFolders = Array.isArray(folders) && folders.length ? folders : config.defaultFolders;
  return targetFolders.map(ensureFolder);
};

const propertySet = new PropertySet(BasePropertySet.IdOnly, [
  EmailMessageSchema.Subject,
  EmailMessageSchema.From,
  EmailMessageSchema.Sender,
  EmailMessageSchema.DateTimeReceived,
  EmailMessageSchema.InternetMessageId,
  EmailMessageSchema.HasAttachments,
  EmailMessageSchema.Body,
  EmailMessageSchema.Size
]);

propertySet.RequestedBodyType = BodyType.Text;

const buildTransform = (mailbox, folder) => (item) => ({
  id: item?.Id?.UniqueId,
  changeKey: item?.Id?.ChangeKey,
  subject: item?.Subject || "",
  from: item?.From?.Address || null,
  sender: item?.Sender?.Address || null,
  receivedAt: item?.DateTimeReceived ? new Date(item.DateTimeReceived).toISOString() : null,
  internetMessageId: item?.InternetMessageId || null,
  hasAttachments: Boolean(item?.HasAttachments),
  size: item?.Size ?? null,
    bodyPreview: item?.Body?.Text ? item.Body.Text.substring(0, 500) : "",
  mailbox,
  folder
});

const findItemsInFolder = async (service, folderDescriptor, query, limit, mailbox, context = {}) => {
  if (limit <= 0) {
    return [];
  }

  const { id: folderId, name: folderName } = folderDescriptor;
  const items = [];
  let view = new ItemView(Math.min(limit, config.pageSize));
  view.PropertySet = propertySet;
  view.Traversal = ItemTraversal.Shallow;
  view.OrderBy.Add(EmailMessageSchema.DateTimeReceived, SortDirection.Descending);

  const transform = buildTransform(mailbox, folderName);

  try {
    let results = await service.FindItems(folderId, query, view);
    const appendResults = (findResults) => {
      if (!findResults?.Items) {
        return;
      }

      findResults.Items.forEach((item) => {
        if (items.length >= limit) {
          return;
        }

        items.push({
          item,
          metadata: transform(item)
        });
      });
    };

    appendResults(results);

    while (results?.MoreAvailable && items.length < limit) {
      const remaining = limit - items.length;
      view = new ItemView(Math.min(remaining, config.pageSize));
      view.PropertySet = propertySet;
      view.Traversal = ItemTraversal.Shallow;
      view.OrderBy.Add(EmailMessageSchema.DateTimeReceived, SortDirection.Descending);
      view.Offset = results.NextPageOffset;

      results = await service.FindItems(folderId, query, view);
      appendResults(results);
    }

    return items.slice(0, limit);
  } catch (error) {
    logger.error(
      { error, mailbox, folder: folderName, requestId: context.requestId },
      "EWS FindItems call failed"
    );
    throw wrapExchangeError(
      "Failed to search mailbox folder",
      error,
      { mailbox, folder: folderName, operation: context.operation || "FindItems" }
    );
  }
};

const impersonateMailbox = (service, mailbox) => {
  service.ImpersonatedUserId = new ImpersonatedUserId(ConnectingIdType.SmtpAddress, mailbox);
};

const getSearchableMailboxes = async (context = {}) => {
  const service = await createService(mergeContext(context, { operation: "GetSearchableMailboxes" }));

  try {
    const response = await service.GetSearchableMailboxes("");

    if (!response?.SearchableMailboxes) {
      return [];
    }

    return response.SearchableMailboxes.filter((entry) => entry.IsSearchable).map((entry) => ({
      displayName: entry.DisplayName,
      smtpAddress: entry.PrimarySmtpAddress,
      isExternal: entry.IsExternalMailbox,
      referenceId: entry.ReferenceId
    }));
  } catch (error) {
    logger.error(
      { error, requestId: context.requestId },
      "Unable to enumerate searchable mailboxes"
    );
    throw wrapExchangeError("Unable to enumerate searchable mailboxes", error, {
      operation: "GetSearchableMailboxes"
    });
  }
};

const collectMatchesForMailbox = async (mailbox, folders, query, limit, context = {}) => {
  const service = await createService(
    mergeContext(context, { operation: "CollectMatches", mailbox: mailbox.smtpAddress })
  );
  impersonateMailbox(service, mailbox.smtpAddress);

  const matches = [];

  for (const folder of folders) {
    const items = await findItemsInFolder(
      service,
      folder,
      query,
      limit - matches.length,
      mailbox.smtpAddress,
      mergeContext(context, { mailbox: mailbox.smtpAddress, folder: folder.name })
    );

    items.forEach((entry) => {
      matches.push(entry.metadata);
    });

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
};

const deleteForMailbox = async (mailbox, folders, query, limit, deleteMode, simulate, context = {}) => {
  const service = await createService(
    mergeContext(context, { operation: "DeleteForMailbox", mailbox: mailbox.smtpAddress })
  );
  impersonateMailbox(service, mailbox.smtpAddress);

  const matches = [];
  const deletableIds = [];

  for (const folder of folders) {
    const items = await findItemsInFolder(
      service,
      folder,
      query,
      limit - matches.length,
      mailbox.smtpAddress,
      mergeContext(context, { mailbox: mailbox.smtpAddress, folder: folder.name })
    );

    items.forEach((entry) => {
      matches.push(entry.metadata);
      deletableIds.push(entry.item.Id);
    });

    if (matches.length >= limit) {
      break;
    }
  }

  if (!simulate && deletableIds.length) {
    try {
      await service.DeleteItems(
        deletableIds,
        deleteMode,
        SendCancellationsMode.SendToNone,
        AffectedTaskOccurrence.AllOccurrences
      );
    } catch (error) {
      logger.error(
        { error, mailbox: mailbox.smtpAddress, requestId: context.requestId },
        "Failed to delete items via EWS"
      );
      throw wrapExchangeError("Failed to delete messages", error, {
        mailbox: mailbox.smtpAddress,
        operation: "DeleteItems"
      });
    }
  }

  return {
    matches,
    deleted: simulate ? 0 : deletableIds.length
  };
};

const searchMessages = async (filters, context = {}) => {
  const {
    sender,
    subject,
    body,
    keywords,
    receivedFrom,
    receivedTo,
    hasAttachments,
    importance,
    folders,
    maxPerMailbox
  } = filters;

  logger.info(
    {
      requestId: context.requestId,
      sender,
      subject,
      receivedFrom,
      receivedTo,
      folders
    },
    "Search request received"
  );

  const mailboxes = await getSearchableMailboxes(context);
  const resolvedFolders = resolveFolders(folders);
  const limit = Math.max(1, Math.min(maxPerMailbox || config.maxPerMailbox, 1000));

  if (!mailboxes.length) {
    return {
      summary: {
        totalMailboxesScanned: 0,
        mailboxesWithMatches: 0,
        totalMessages: 0
      },
      query: null,
      results: [],
      failures: []
    };
  }

  const query = buildAqsQuery({ sender, subject, body, keywords, receivedFrom, receivedTo, hasAttachments, importance });
  const queue = new PQueue({ concurrency: config.maxConcurrency });

  const tasks = mailboxes.map((mailbox) =>
    queue.add(async () => {
      try {
        const matches = await collectMatchesForMailbox(
          mailbox,
          resolvedFolders,
          query,
          limit,
          mergeContext(context, { mailbox: mailbox.smtpAddress, operation: "SearchMessages" })
        );

        if (!matches.length) {
          return null;
        }

        return {
          mailbox: mailbox.smtpAddress,
          displayName: mailbox.displayName,
          totalMatches: matches.length,
          matches
        };
      } catch (error) {
        logger.error(
          { error, mailbox: mailbox.smtpAddress, requestId: context.requestId },
          "Unable to collect matches for mailbox"
        );
        return {
          error: error.message,
          mailbox: mailbox.smtpAddress,
          displayName: mailbox.displayName,
          details: error.details
        };
      }
    })
  );

  const results = await Promise.all(tasks);

  const mailboxResults = [];
  const failures = [];

  results.forEach((result) => {
    if (!result) {
      return;
    }

    if (result.error) {
      failures.push(result);
      return;
    }

    mailboxResults.push(result);
  });

  const totalMessages = mailboxResults.reduce((sum, mailbox) => sum + mailbox.totalMatches, 0);

  return {
    summary: {
      totalMailboxesScanned: mailboxes.length,
      mailboxesWithMatches: mailboxResults.length,
      totalMessages
    },
    query,
    results: mailboxResults.sort((a, b) => a.mailbox.localeCompare(b.mailbox)),
    failures
  };
};

const deleteMessages = async (filters, context = {}) => {
  const {
    sender,
    subject,
    body,
    receivedFrom,
    receivedTo,
    folders,
    maxPerMailbox,
    deleteMode = "softDelete",
    simulate = true
  } = filters;

  logger.info(
    {
      requestId: context.requestId,
      sender,
      subject,
      receivedFrom,
      receivedTo,
      folders,
      deleteMode,
      simulate
    },
    "Delete request received"
  );

  const mailboxes = await getSearchableMailboxes(context);
  const resolvedFolders = resolveFolders(folders);
  const limit = Math.max(1, Math.min(maxPerMailbox || config.maxPerMailbox, 2000));
  const modeKey = deleteMode.toLowerCase();
  const mode = DELETE_MODE_MAP[modeKey] || DeleteMode.SoftDelete;
  const effectiveModeKey = DELETE_MODE_MAP[modeKey] ? modeKey : "softdelete";

  if (!mailboxes.length) {
    return {
      summary: {
        totalMailboxesScanned: 0,
        mailboxesWithMatches: 0,
        totalMatches: 0,
        totalDeleted: 0,
        mode: effectiveModeKey,
        simulate
      },
      query: null,
      results: [],
      failures: []
    };
  }

  const query = buildAqsQuery({ sender, subject, body, receivedFrom, receivedTo });
  const queue = new PQueue({ concurrency: config.maxConcurrency });

  const tasks = mailboxes.map((mailbox) =>
    queue.add(async () => {
      try {
        const { matches, deleted } = await deleteForMailbox(
          mailbox,
          resolvedFolders,
          query,
          limit,
          mode,
          simulate,
          mergeContext(context, { mailbox: mailbox.smtpAddress, operation: "DeleteMessages" })
        );

        if (!matches.length) {
          return null;
        }

        return {
          mailbox: mailbox.smtpAddress,
          displayName: mailbox.displayName,
          totalMatches: matches.length,
          deleted,
          folders: [...new Set(matches.map((match) => match.folder))],
          matches
        };
      } catch (error) {
        logger.error(
          { error, mailbox: mailbox.smtpAddress, requestId: context.requestId },
          "Unable to delete messages for mailbox"
        );
        return {
          error: error.message,
          mailbox: mailbox.smtpAddress,
          displayName: mailbox.displayName,
          details: error.details
        };
      }
    })
  );

  const results = await Promise.all(tasks);

  const mailboxResults = [];
  const failures = [];
  let totalDeleted = 0;

  results.forEach((result) => {
    if (!result) {
      return;
    }

    if (result.error) {
      failures.push(result);
      return;
    }

    totalDeleted += result.deleted;
    mailboxResults.push(result);
  });

  const totalMatches = mailboxResults.reduce((sum, mailbox) => sum + mailbox.totalMatches, 0);

  return {
    summary: {
      totalMailboxesScanned: mailboxes.length,
      mailboxesWithMatches: mailboxResults.length,
      totalMatches,
      totalDeleted,
      mode: effectiveModeKey,
      simulate
    },
    query,
    results: mailboxResults.sort((a, b) => a.mailbox.localeCompare(b.mailbox)),
    failures
  };
};

module.exports = {
  searchMessages,
  deleteMessages,
  listMailboxes: (context) => getSearchableMailboxes(context)
};



/* -*- Mode: js; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

var MessageManager = {

  activity: null,

  init: function mm_init(callback) {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    // Allow for stubbing in environments that do not implement the
    // `navigator.mozMobileMessage` API
    this._mozMobileMessage = navigator.mozMobileMessage ||
                    window.DesktopMockNavigatormozMobileMessage;

    this._mozMobileMessage.addEventListener('received',
        this.onMessageReceived.bind(this));
    this._mozMobileMessage.addEventListener('sending', this.onMessageSending);
    this._mozMobileMessage.addEventListener('sent', this.onMessageSent);
    this._mozMobileMessage.addEventListener('failed', this.onMessageFailed);
    this._mozMobileMessage.addEventListener('deliverysuccess',
                                            this.onDeliverySuccess);
    window.addEventListener('hashchange', this.onHashChange.bind(this));
    document.addEventListener('visibilitychange',
                              this.onVisibilityChange.bind(this));
    // Initialize DOM elements which will be used in this code
    [
      'main-wrapper', 'thread-messages'
    ].forEach(function(id) {
      this[Utils.camelCase(id)] = document.getElementById(id);
    }, this);
    // Callback if needed
    if (typeof callback === 'function') {
      callback();
    }
  },

  onMessageSending: function mm_onMessageSending(e) {
    var message = e.message;
    var threadId = message.threadId;

    if (Threads.has(threadId)) {
      Threads.get(message.threadId).messages.push(message);
    }

    if (window.location.hash === '#new') {
      // If we are in 'new' we go to right to thread view
      window.location.hash = '#thread=' + threadId;
    } else if (threadId === Threads.currentId) {
      ThreadUI.appendMessage(message);
      ThreadUI.scrollViewToBottom();
    }
    MessageManager.getThreads(ThreadListUI.renderThreads);
  },

  onMessageFailed: function mm_onMessageFailed(e) {
    ThreadUI.onMessageFailed(e.message);
  },

  onDeliverySuccess: function mm_onDeliverySuccess(e) {
    ThreadUI.onDeliverySuccess(e.message);
  },

  onMessageSent: function mm_onMessageSent(e) {
    ThreadUI.onMessageSent(e.message);
  },

  onMessageReceived: function mm_onMessageReceived(e) {
    var message = e.message;
    var threadId;

    if (message.messageClass && message.messageClass === 'class-0') {
      return;
    }

    // Here we can only have one sender, so deliveryStatus[0] => message
    // status from sender. Ignore 'pending' messages that are received
    // this means we are in automatic download mode
    if (message.delivery === 'not-downloaded' &&
        message.deliveryStatus[0] === 'pending') {
      return;
    }

    threadId = message.threadId;

    if (Threads.has(threadId)) {
      Threads.get(threadId).messages.push(message);
    }

    if (threadId === Threads.currentId) {
      //Append message and mark as unread
      this.markMessagesRead([message.id], true, function() {
        MessageManager.getThreads(ThreadListUI.renderThreads);
      });
      ThreadUI.appendMessage(message);
      ThreadUI.scrollViewToBottom();
      Utils.updateTimeHeaders();
    } else {
      ThreadListUI.onMessageReceived(message);
    }
  },

  onVisibilityChange: function mm_onVisibilityChange(e) {
    LinkActionHandler.reset();
    ThreadListUI.updateContactsInfo();
    ThreadUI.updateHeaderData();
    Utils.updateTimeHeaders();

    // If we receive a message with screen off, the height is
    // set to 0 and future checks will fail. So we update if needed
    if (!ThreadListUI.fullHeight || ThreadListUI.fullHeight === 0) {
      ThreadListUI.fullHeight = ThreadListUI.container.offsetHeight;
    }
  },

  slide: function mm_slide(direction, callback) {
    // If no sliding is necessary, schedule the callback to be invoked as soon
    // as possible (maintaining the asynchronous API of this method)
    if (this.mainWrapper.dataset.position === direction) {
      setTimeout(callback);
      return;
    }

    this.mainWrapper.classList.add('peek');
    this.mainWrapper.dataset.position = direction;
    var self = this;
    // We have 2 panels, so we get 2 transitionend for each step
    var trEndCount = 0;
    this.mainWrapper.addEventListener('transitionend', function trWait() {
      trEndCount++;

      switch (trEndCount) {
        case 2:
          self.mainWrapper.classList.remove('peek');
          break;
        case 4:
          self.mainWrapper.removeEventListener('transitionend', trWait);
          if (callback) {
            callback();
          }
          break;
      }
    });
  },

  launchComposer: function mm_openComposer(activity) {
    // Do we have to handle a pending activity?
    ThreadUI.cleanFields(true);
    Compose.clear();
    this.threadMessages.classList.add('new');

    MessageManager.slide('left', function() {
      ThreadUI.initRecipients();
      if (!activity) {
        return;
      }

      /**
       * Choose the appropriate contact resolver:
       *  - if we have a phone number and no contact, rely on findByPhoneNumber
       *    to get a contact matching the number;
       *  - if we have a contact object and no phone number, just use a dummy
       *    source that returns the contact.
       */
      var findByPhoneNumber = Contacts.findByPhoneNumber.bind(Contacts);
      var number = activity.number;
      if (activity.contact && !number) {
        findByPhoneNumber = function dummySource(contact, cb) {
          cb(activity.contact);
        };
        number = activity.contact.number || activity.contact.tel[0].value;
      }

      // Add recipients and fill+focus the Compose area.
      if (activity.contact && number) {
        Utils.getContactDisplayInfo(
          findByPhoneNumber, number, function onData(data) {
            data.source = 'contacts';
            ThreadUI.recipients.add(data);
            ThreadUI.setMessageBody(activity.body);
          }
        );
      } else {
        if (number) {
          // If the activity delivered the number of an unknown recipient,
          // create a recipient directly.
          ThreadUI.recipients.add({
            number: number,
            source: 'manual'
          });
        }
        ThreadUI.setMessageBody(activity.body);
      }

      // Clean activity object
      this.activity = null;
    }.bind(this));
  },

  onHashChange: function mm_onHashChange(e) {
    // Ensure that no specific element is left focused
    // when changing UI panels
    document.activeElement.blur();

    // Group Participants should never persist any hash changes
    ThreadUI.groupView.reset();

    // Leave the edit mode before transitioning to another panel. This is safe
    // to do even if we're not in edit mode as it's essentially a no-op then.
    ThreadUI.cancelEdit();
    ThreadListUI.cancelEdit();

    switch (window.location.hash) {
      case '#new':
        this.launchComposer(this.activity);
        break;
      case '#thread-list':
        ThreadUI.inThread = false;
        var self = this;
        //Keep the  visible button the :last-child
        var editButton = document.getElementById('messages-edit-icon');
        editButton.parentNode.appendChild(editButton);
        if (this.threadMessages.classList.contains('new')) {
          MessageManager.slide('right', function() {
            self.threadMessages.classList.remove('new');
          });
        } else {
          // Clear it before sliding.
          ThreadUI.container.textContent = '';
          var self = this;
          MessageManager.slide('right', function() {
            if (self.activity && self.activity.threadId) {
              window.location.hash = '#thread=' + self.activity.threadId;
              self.activity = null;
            }
          });
        }
        break;
      case '#group-view':
        ThreadUI.groupView();
        break;
      default:
        var threadId = Threads.currentId;
        var filter;

        if (threadId) {
          filter = new MozSmsFilter();
          filter.threadId = threadId;

          if (this.threadMessages.classList.contains('new')) {
            // After a message is sent...
            //
            this.threadMessages.classList.remove('new');

            ThreadUI.updateHeaderData(function() {
              ThreadUI.renderMessages(filter);
            });
          } else {
            // Viewing received messages...
            //
            ThreadListUI.mark(threadId, 'read');

            // Update Header
            ThreadUI.updateHeaderData(function updateHeader() {
              MessageManager.slide('left', function slideEnd() {
                // hashchanges from #group-view back to #thread=n
                // are considered "in thread" and should not
                // trigger a complete re-rendering of the messages
                // in the thread.
                if (!ThreadUI.inThread) {
                  ThreadUI.inThread = true;
                  ThreadUI.renderMessages(filter);
                }
              });
            });
          }
        }
      break;
    }

  },

  getThreads: function mm_getThreads(callback, extraArg) {
    var cursor = this._mozMobileMessage.getThreads(),
        threads = [];

    cursor.onsuccess = function onsuccess() {
      if (this.result) {
        threads.push(this.result);

        // Register all threads to the Threads object.
        Threads.set(this.result.id, this.result);

        // If one of the requested threads is also the
        // currently displayed thread, update the header immediately
        if (this.result.id === Threads.currentId) {
          ThreadUI.updateHeaderData();
        }

        this.continue();
        return;
      }
      if (callback) {
        callback(threads, extraArg);
      }
    };

    cursor.onerror = function onerror() {
      var msg = 'Reading the database. Error: ' + this.error.name;
      console.log(msg);
    };
  },

  getMessage: function mm_getMsg(id) {
    return this._mozMobileMessage.getMessage(id);
  },

  retrieveMMS: function mm_retrieveMMS(id) {
    return this._mozMobileMessage.retrieveMMS(id);
  },

  getMessages: function mm_getMgs(options) {
    /*
    options {
      each: callback function invoked for each message
      end: callback function invoked when cursor is "done"
      endArgs: specify arguments for the "end" callback
      filter: a MozMessageFilter or similar object
      invert: option to invert the selection
    }

     */
    var each = options.each;
    var filter = options.filter;
    var invert = options.invert;
    var end = options.end;
    var endArgs = options.endArgs;
    var cursor = this._mozMobileMessage.getMessages(filter, !invert);

    cursor.onsuccess = function onsuccess() {
      if (!this.done) {
        var shouldContinue = true;
        if (each) {
          shouldContinue = each(this.result);
        }
        // if each returns false the iteration stops
        if (shouldContinue !== false) { // if this is undefined this is fine
          this.continue();
        }
      } else {
        if (end) {
          end(endArgs);
        }
      }
    };
    cursor.onerror = function onerror() {
      var msg = 'Reading the database. Error: ' + this.error.name;
      console.log(msg);
    };
  },

  // consider splitting this method for the different use cases
  sendSMS: function mm_send(recipients, content,
                            onsuccess, onerror, oncomplete) {
    var requests;

    if (!Array.isArray(recipients)) {
      recipients = [recipients];
    }

    // The returned value is not a DOM request!
    // Instead, It's an array of DOM requests.
    var i = 0;
    var requestResult = { success: [], error: [] };

    requests = this._mozMobileMessage.send(recipients, content);
    var numberOfRequests = requests.length;

    requests.forEach(function(request) {
      request.onsuccess = function onSuccess(event) {
        onsuccess && onsuccess(event.target.result);

        requestResult.success.push(event.target.result);
        if (i === numberOfRequests - 1) {
          oncomplete && oncomplete(requestResult);
        }
        i++;
      };

      request.onerror = function onError(event) {
        console.log('Error Sending: ' + JSON.stringify(event.target.error));
        onerror && onerror(event.target.error);

        requestResult.error.push(event.target.error);
        if (i === numberOfRequests - 1) {
          oncomplete && oncomplete(requestResult);
        }
        i++;
      };
    });
  },

  sendMMS: function mm_sendMMS(recipients, content, onsuccess, onerror) {
    var request;

    if (!Array.isArray(recipients)) {
      recipients = [recipients];
    }

    var message = SMIL.generate(content);

    request = this._mozMobileMessage.sendMMS({
      subject: '',
      receivers: recipients,
      smil: message.smil,
      attachments: message.attachments
    });

    request.onsuccess = function onSuccess(event) {
      onsuccess && onsuccess(event.target.result);
    };

    request.onerror = function onError(event) {
      onerror && onerror(event.target.error);
    };
  },

  // takes a formatted message in case you happen to have one
  resendMessage: function mm_resendMessage(message, callback) {
    var request;
    if (message.type === 'sms') {
      request = this._mozMobileMessage.send(message.receiver, message.body);
    }
    if (message.type === 'mms') {
      request = this._mozMobileMessage.sendMMS({
        receivers: message.receivers,
        subject: message.subject,
        smil: message.smil,
        attachments: message.attachments
      });
    }

    request.onsuccess = function onSuccess(evt) {
      MessageManager.deleteMessage(message.id);
      if (callback) {
        callback(null, evt.target.result);
      }
    };

    request.onerror = function onError(evt) {
      MessageManager.deleteMessage(message.id);
      if (callback) {
        callback(evt.target.error);
      }
    };

    return request;
  },

  deleteMessage: function mm_deleteMessage(id, callback) {
    var req = this._mozMobileMessage.delete(id);
    req.onsuccess = function onsuccess() {
      callback && callback(this.result);
    };

    req.onerror = function onerror() {
      var msg = 'Deleting in the database. Error: ' + req.error.name;
      console.log(msg);
      callback && callback(null);
    };
  },

  /*
    TODO: If the messages could not be deleted completely,
    conversation list page will also update without notification currently.
    May need more infomation for user that the messages were not
    removed completely.
  */
  deleteMessages: function mm_deleteMessages(list, callback) {
    // mozMobileMessage.delete() has been modified per bug 771458.
    // Now deleteMessage() can take an id or an array of id.
    this.deleteMessage(list, callback);
  },

  markMessagesRead: function mm_markMessagesRead(list, value, callback) {
    if (!this._mozMobileMessage || !list.length) {
      return;
    }

    // We chain the calls to the API in a way that we make no call to
    // 'markMessageRead' until a previous call is completed. This way any
    // other potential call to the API, like the one for getting a message
    // list, could be done within the calls to mark the messages as read.
    var req = this._mozMobileMessage.markMessageRead(list.pop(), value);

    req.onsuccess = (function onsuccess() {
      if (!list.length && callback) {
        callback(req.result);
        return;
      }
      this.markMessagesRead(list, value, callback);
    }).bind(this);

    req.onerror = function onerror() {
      if (callback) {
        callback(null);
      }
    };
  }
};

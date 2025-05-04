/**
 * Persistent Chorus Implementation
 *
 * This script implements the following behaviour:
 * 1. The chorus appears at the start of the qasida in its normal position
 * 2. As the user scrolls down, the chorus remains visible until it scrolls out of view
 * 3. When scrolling down to read further verses, the chorus disappears
 * 4. When gently scrolling up, the chorus reappears as a floating element
 * 5. When scrolling up vigorously, the chorus disappears (to allow reading previous verses)
 * 6. When gently scrolling up a little again, the chorus reappears
 * 7. When scrolling down, the chorus disappears again
 *
 */
document.addEventListener('DOMContentLoaded', function() {
  // Configuration constants
  const CONFIG = {
    GENTLE_SCROLL_THRESHOLD: 0.5,      // px/ms - threshold for determining gentle scrolling
    VIGOROUS_SCROLL_THRESHOLD: 1.2,    // px/ms - threshold for determining vigorous scrolling
    DIRECTION_CHANGE_GRACE_PERIOD: 50, // px - distance to scroll after direction change before applying rules
    SCROLL_SAMPLE_RATE: 50,            // ms - how often to check scroll position
    ACTIVE_SCROLL_TIMEOUT: 200,        // ms - time after last scroll event to consider scrolling "stopped"
    TOP_MARGIN: 60                     // px - space between top of viewport and persistent chorus
  };

  // Find all qasida containers
  const qasidaContainers = document.querySelectorAll('.qasida-container[data-has-chorus="true"]');

  // If no qasidas with chorus, exit
  if (qasidaContainers.length === 0) {
    return;
  }

  // Process each qasida container
  qasidaContainers.forEach(qasidaContainer => {
    setupPersistentChorus(qasidaContainer);
  });

  function setupPersistentChorus(qasidaContainer) {
    // Get original chorus containers within this qasida
    const originalChorusContainers = qasidaContainer.querySelectorAll('.chorus-container');

    // If no chorus, exit
    if (originalChorusContainers.length === 0) {
      return;
    }

    // Handle empty chorus case - check if the chorus container is empty or has no content
    const hasEmptyChorus = Array.from(originalChorusContainers).some(container => {
      // Check if the container is empty or has only whitespace/formatting elements
      const hasContent = container.querySelector('.verse') ||
                         container.querySelector('.arabic') ||
                         container.querySelector('.transliteration') ||
                         container.querySelector('.translation');
      return !hasContent || container.innerText.trim() === '';
    });

    if (hasEmptyChorus) {
      return; // Don't create persistent chorus for empty choruses
    }

    // Determine the book page and markdown container dimensions for proper positioning
    const bookPage = document.querySelector('.book-page');
    const markdownContainer = document.querySelector('.markdown');

    let containerWidth = '100%';
    let containerMaxWidth = 'none';
    let containerPadding = '0 1rem';
    let containerMargin = '0 auto';

    if (markdownContainer) {
      const markdownStyles = window.getComputedStyle(markdownContainer);
      containerWidth = markdownStyles.width;
      containerMaxWidth = markdownStyles.maxWidth || '80rem'; // Default hugo-book max-width
      containerPadding = markdownStyles.padding;
      containerMargin = markdownStyles.margin;
    } else if (bookPage) {
      const bookPageStyles = window.getComputedStyle(bookPage);
      containerWidth = bookPageStyles.width;
      containerMaxWidth = bookPageStyles.maxWidth || '80rem'; // Default hugo-book max-width
      containerPadding = bookPageStyles.padding;
      containerMargin = bookPageStyles.margin;
    }

    // Create persistent chorus elements with proper container structure
    const persistentChorusElements = [];
    // Set default visibility - only first chorus visible by default when multiple exist
    const hasMultipleChorus = originalChorusContainers.length > 1;
    originalChorusContainers.forEach((originalChorus, index) => {
      // Create the outer fixed wrapper
      const persistentWrapper = document.createElement('div');
      persistentWrapper.className = 'persistent-chorus-wrapper';
      persistentWrapper.style.position = 'fixed';
      persistentWrapper.style.top = '4rem'; // Below header
      persistentWrapper.style.left = '0';
      persistentWrapper.style.right = '0';
      persistentWrapper.style.zIndex = '100';
      persistentWrapper.style.display = 'flex';
      persistentWrapper.style.justifyContent = 'center';
      persistentWrapper.style.pointerEvents = 'none'; // Allow clicks to pass through

      // Create the inner container that matches content area dimensions
      const innerContainer = document.createElement('div');
      innerContainer.className = 'persistent-chorus-inner';
      innerContainer.style.width = containerWidth;
      innerContainer.style.maxWidth = containerMaxWidth;
      innerContainer.style.padding = containerPadding;
      innerContainer.style.margin = containerMargin;
      innerContainer.style.pointerEvents = 'auto'; // Re-enable pointer events

      // Create a clone of the original chorus
      const persistentChorus = originalChorus.cloneNode(true);
      persistentChorus.classList.remove('chorus-container');
      persistentChorus.classList.add('persistent-chorus');
      persistentChorus.classList.add('hidden'); // Start hidden

      // For multiple choruses, special handling for second chorus
      if (hasMultipleChorus && index > 0) {
        persistentChorus.style.display = 'none'; // Initially hidden
      }
      persistentChorus.id = `persistent-chorus-${qasidaContainer.id || 'qasida'}-${index}`;
      persistentChorus.setAttribute('aria-hidden', 'true');
      persistentChorus.setAttribute('data-original-id', originalChorus.id || '');

      // FIX: Remove duplicated translations (keep only the ones inside tables)
      // This fixes the iPhone 12 Pro duplication issue
      const standaloneTranslations = persistentChorus.querySelectorAll('.translation');
      standaloneTranslations.forEach(elem => {
        elem.remove();
      });

      // Also remove the standalone transliterations (keep only the ones inside tables)
      const standaloneTransliterations = persistentChorus.querySelectorAll('.transliteration');
      standaloneTransliterations.forEach(elem => {
        elem.remove();
      });

      // Add a chorus indicator with number if there are multiple choruses
      const indicator = document.createElement('div');
      indicator.className = 'chorus-indicator';
      indicator.textContent = originalChorusContainers.length > 1 ?
        (index === 0 ? 'Chorus 1/2' : 'Chorus 2/2') : 'Chorus';
      indicator.style.textAlign = 'center';
      indicator.style.fontSize = '0.8rem';
      indicator.style.color = '#666';
      indicator.style.marginBottom = '0.5rem';
      persistentChorus.insertBefore(indicator, persistentChorus.firstChild);

      // Add chorus toggle button if there are multiple choruses and this is the first chorus
      if (originalChorusContainers.length > 1 && index === 0) {
        const chorusToggle = document.createElement('button');
        chorusToggle.className = 'chorus-toggle';
        chorusToggle.textContent = 'Chorus 2';
        chorusToggle.setAttribute('aria-label', 'Switch to next chorus');
        chorusToggle.style.position = 'absolute';
        chorusToggle.style.top = '5px';
        chorusToggle.style.right = '5px';
        chorusToggle.style.background = 'rgba(255, 255, 255, 0.8)';
        chorusToggle.style.border = '1px solid #ccc';
        chorusToggle.style.borderRadius = '3px';
        chorusToggle.style.padding = '2px 5px';
        chorusToggle.style.fontSize = '10px';
        chorusToggle.style.color = '#666';
        chorusToggle.style.cursor = 'pointer';
        chorusToggle.style.zIndex = '11'; // Higher than translation toggle

        // Store which chorus is currently shown (0 = first, 1 = second)
        persistentChorus.setAttribute('data-current-chorus', '0');

        chorusToggle.addEventListener('click', function() {
          const currentChorus = persistentChorus.getAttribute('data-current-chorus');
          if (currentChorus === '0') {
            // Switch to chorus 2
            persistentChorusElements[0].chorus.style.display = 'none'; // Hide first chorus
            persistentChorusElements[1].chorus.style.display = 'block'; // Show second chorus
            chorusToggle.textContent = 'Chorus 1';
            persistentChorus.setAttribute('data-current-chorus', '1');
          } else {
            // Switch to chorus 1
            persistentChorusElements[0].chorus.style.display = 'block'; // Show first chorus
            persistentChorusElements[1].chorus.style.display = 'none'; // Hide second chorus
            chorusToggle.textContent = 'Chorus 2';
            persistentChorus.setAttribute('data-current-chorus', '0');
          }
        });

        persistentChorus.appendChild(chorusToggle);
      }

      // Handle Arabic font size based on screen size (force smaller size on mobile)
      if (window.innerWidth <= 375) { // iPhone SE size screens
        const arabicElements = persistentChorus.querySelectorAll('.arabic');
        arabicElements.forEach(elem => {
          elem.style.fontSize = '100%';
        });
      } else if (window.innerWidth <= 767) { // Regular phone screens
        const arabicElements = persistentChorus.querySelectorAll('.arabic');
        arabicElements.forEach(elem => {
          elem.style.fontSize = '120%';
        });
      }

      // Add a toggle button for translations on small screens
      if (window.innerWidth <= 375) { // Small screen detection
        const toggleButton = document.createElement('button');
        toggleButton.className = 'persistent-chorus-toggle';
        toggleButton.textContent = 'Show Trans';
        toggleButton.setAttribute('aria-label', 'Toggle translations');
        toggleButton.style.position = 'absolute';
        toggleButton.style.top = '5px';
        toggleButton.style.right = '5px';
        toggleButton.style.background = 'rgba(255, 255, 255, 0.8)';
        toggleButton.style.border = '1px solid #ccc';
        toggleButton.style.borderRadius = '3px';
        toggleButton.style.padding = '2px 5px';
        toggleButton.style.fontSize = '10px';
        toggleButton.style.color = '#666';
        toggleButton.style.cursor = 'pointer';
        toggleButton.style.zIndex = '10';

        toggleButton.addEventListener('click', function() {
          const translations = persistentChorus.querySelectorAll('.translation-phrase-by-phrase');
          let isVisible = false;

          translations.forEach(elem => {
            if (elem.style.display === 'none' || getComputedStyle(elem).display === 'none') {
              elem.style.display = 'table-row';
              isVisible = true;
            } else {
              elem.style.display = 'none';
              isVisible = false;
            }
          });

          toggleButton.textContent = isVisible ? 'Hide Trans' : 'Show Trans';
        });

        persistentChorus.appendChild(toggleButton);
      }

      // Assemble the DOM structure
      innerContainer.appendChild(persistentChorus);
      persistentWrapper.appendChild(innerContainer);
      document.body.appendChild(persistentWrapper);

      // Store references to all parts
      persistentChorusElements.push({
        wrapper: persistentWrapper,
        inner: innerContainer,
        chorus: persistentChorus
      });

      // Associate the persistent chorus with its original
      originalChorus.setAttribute('data-persistent-id', persistentChorus.id);
    });

    // Set up scroll behavior for this qasida
    setupScrollBehavior(qasidaContainer, originalChorusContainers, persistentChorusElements);
  }

  function setupScrollBehavior(qasidaContainer, originalChorusContainers, persistentChorusElements) {
    // Variables for scroll tracking
    const scrollState = {
      lastScrollY: window.scrollY,
      scrollStartY: window.scrollY,
      isScrollingUp: false,
      scrollVelocity: 0,
      lastScrollTime: Date.now(),
      scrollDirection: null,
      scrollDistanceSinceDirectionChange: 0,
      activeScrollTimer: null
    };

    function handleScroll() {
      const currentScrollY = window.scrollY;
      const currentTime = Date.now();

      // Determine scroll direction
      const newScrollingUp = currentScrollY < scrollState.lastScrollY;

      // Detect direction change
      if (newScrollingUp !== scrollState.isScrollingUp) {
        scrollState.scrollStartY = scrollState.lastScrollY;
        scrollState.scrollDistanceSinceDirectionChange = 0;
        scrollState.scrollDirection = newScrollingUp ? 'up' : 'down';
      } else {
        scrollState.scrollDistanceSinceDirectionChange = Math.abs(currentScrollY - scrollState.scrollStartY);
      }

      scrollState.isScrollingUp = newScrollingUp;

      // Calculate scroll velocity
      const timeDelta = currentTime - scrollState.lastScrollTime;
      if (timeDelta > 0) {
        scrollState.scrollVelocity = Math.abs(currentScrollY - scrollState.lastScrollY) / timeDelta;
      }

      // Determine scroll characteristics
      const isGentleScroll = scrollState.scrollVelocity < CONFIG.GENTLE_SCROLL_THRESHOLD;
      const isVigorousScroll = scrollState.scrollVelocity > CONFIG.VIGOROUS_SCROLL_THRESHOLD;
      const hasScrolledSinceDirectionChange = scrollState.scrollDistanceSinceDirectionChange > CONFIG.DIRECTION_CHANGE_GRACE_PERIOD;

      // Process each chorus pair
      originalChorusContainers.forEach((originalChorus, index) => {
        const persistentChorusSet = persistentChorusElements[index];

        if (!persistentChorusSet) return;

        const persistentWrapper = persistentChorusSet.wrapper;
        const persistentChorus = persistentChorusSet.chorus;

        // Check if original chorus is visible in viewport
        const rect = originalChorus.getBoundingClientRect();
        const isOriginalVisible = rect.top < window.innerHeight && rect.bottom > 0;

        if (isOriginalVisible) {
          // Original is visible, hide persistent
          persistentWrapper.classList.add('hidden');
          persistentChorus.classList.add('hidden');
        } else {
          // Apply specific behavior based on scroll direction and velocity
          if (scrollState.scrollDirection === 'up' && hasScrolledSinceDirectionChange) {
            if (isGentleScroll) {
              // Gently scrolling up should show the chorus
              persistentWrapper.classList.remove('hidden');

              // For multiple choruses, we need separate behavior
              if (originalChorusContainers.length > 1) {
                // The display property is used to toggle between choruses
                // but the hidden class handles visibility from scrolling
                persistentChorus.classList.remove('hidden');
              } else {
                // Single chorus case - just show it
                persistentChorus.classList.remove('hidden');
              }
            } else if (isVigorousScroll) {
              // Vigorously scrolling up should hide the chorus
              persistentWrapper.classList.add('hidden');
              persistentChorus.classList.add('hidden');
            }
          } else if (scrollState.scrollDirection === 'down') {
            // When scrolling down, always hide the chorus
            persistentWrapper.classList.add('hidden');
            persistentChorus.classList.add('hidden');
          }
        }
      });

      // Update tracking variables
      scrollState.lastScrollY = currentScrollY;
      scrollState.lastScrollTime = currentTime;

      // Reset the active scroll timer
      if (scrollState.activeScrollTimer) {
        clearTimeout(scrollState.activeScrollTimer);
      }

      // Set a timer to indicate when scrolling has "stopped"
      scrollState.activeScrollTimer = setTimeout(() => {
        // After a period of no scrolling, make sure the persistent chorus is shown
        // if we're not at the top of the page and not seeing the original chorus
        if (window.scrollY > 100) {
          originalChorusContainers.forEach((originalChorus, index) => {
            const persistentChorusSet = persistentChorusElements[index];
            if (!persistentChorusSet) return;

            const persistentWrapper = persistentChorusSet.wrapper;
            const persistentChorus = persistentChorusSet.chorus;

            const rect = originalChorus.getBoundingClientRect();
            const isOriginalVisible = rect.top < window.innerHeight && rect.bottom > 0;

            if (!isOriginalVisible && scrollState.scrollDirection === 'up') {
              persistentWrapper.classList.remove('hidden');
              persistentChorus.classList.remove('hidden');
              // Don't need to set display property here as that's handled by the toggle button
            }
          });
        }
      }, CONFIG.ACTIVE_SCROLL_TIMEOUT);
    }

    // Set up scroll listener with throttling
    let scrollTimeout;
    window.addEventListener('scroll', function() {
      if (!scrollTimeout) {
        scrollTimeout = setTimeout(function() {
          handleScroll();
          scrollTimeout = null;
        }, CONFIG.SCROLL_SAMPLE_RATE);
      }
    }, { passive: true });

    // Add click handlers for chorus toggles if multiple choruses exist
    // For both chorus containers, we set initial setup
    if (persistentChorusElements.length > 1) {
      // Show first chorus, hide second chorus by default
      persistentChorusElements[0].chorus.style.display = 'block';
      persistentChorusElements[1].chorus.style.display = 'none';
    }

    // Initial check
    handleScroll();

    // Handle window resize events
    window.addEventListener('resize', function() {
      // Update container dimensions when window resizes
      updateContainerDimensions(persistentChorusElements);
      handleScroll();
    }, { passive: true });

    // Clean up when leaving the page
    window.addEventListener('beforeunload', function() {
      // Remove persistent choruses to prevent duplicates on page refresh
      persistentChorusElements.forEach(elements => {
        if (elements.wrapper && elements.wrapper.parentNode) {
          elements.wrapper.parentNode.removeChild(elements.wrapper);
        }
      });
    });
  }

  // Helper function to update container dimensions when window resizes
  function updateContainerDimensions(persistentChorusElements) {
    const bookPage = document.querySelector('.book-page');
    const markdownContainer = document.querySelector('.markdown');

    let containerWidth = '100%';
    let containerMaxWidth = 'none';
    let containerPadding = '0 1rem';
    let containerMargin = '0 auto';

    if (markdownContainer) {
      const markdownStyles = window.getComputedStyle(markdownContainer);
      containerWidth = markdownStyles.width;
      containerMaxWidth = markdownStyles.maxWidth || '80rem';
      containerPadding = markdownStyles.padding;
      containerMargin = markdownStyles.margin;
    } else if (bookPage) {
      const bookPageStyles = window.getComputedStyle(bookPage);
      containerWidth = bookPageStyles.width;
      containerMaxWidth = bookPageStyles.maxWidth || '80rem';
      containerPadding = bookPageStyles.padding;
      containerMargin = bookPageStyles.margin;
    }

    const isSmallScreen = window.innerWidth <= 375;
    const isMediumScreen = window.innerWidth <= 767 && window.innerWidth > 375;

    persistentChorusElements.forEach(elements => {
      if (elements.inner) {
        elements.inner.style.width = containerWidth;
        elements.inner.style.maxWidth = containerMaxWidth;
        elements.inner.style.padding = containerPadding;
        elements.inner.style.margin = containerMargin;
      }



      // Handle font sizes and toggle button visibility based on screen size
      if (elements.chorus) {
        const chorus = elements.chorus;
        const existingToggle = chorus.querySelector('.persistent-chorus-toggle');
        const translations = chorus.querySelectorAll('.translation-phrase-by-phrase');
        const arabicElements = chorus.querySelectorAll('.arabic');

        // Force smaller Arabic font size on small screens
        if (isSmallScreen) {
          // Very small screens (iPhone SE size)
          arabicElements.forEach(elem => {
            elem.style.fontSize = '100%';
          });
        } else if (isMediumScreen) {
          // Medium small screens (regular phones)
          arabicElements.forEach(elem => {
            elem.style.fontSize = '120%';
          });
        }

        if (isSmallScreen) {
          // Small screen - show toggle button if not already there
          if (!existingToggle) {
            const toggleButton = document.createElement('button');
            toggleButton.className = 'persistent-chorus-toggle';
            toggleButton.textContent = 'Show Trans';
            toggleButton.setAttribute('aria-label', 'Toggle translations');
            toggleButton.style.position = 'absolute';
            toggleButton.style.top = '5px';
            toggleButton.style.right = '5px';
            toggleButton.style.background = 'rgba(255, 255, 255, 0.8)';
            toggleButton.style.border = '1px solid #ccc';
            toggleButton.style.borderRadius = '3px';
            toggleButton.style.padding = '2px 5px';
            toggleButton.style.fontSize = '10px';
            toggleButton.style.color = '#666';
            toggleButton.style.cursor = 'pointer';
            toggleButton.style.zIndex = '10';

            toggleButton.addEventListener('click', function() {
              let isVisible = false;

              translations.forEach(elem => {
                if (elem.style.display === 'none' || getComputedStyle(elem).display === 'none') {
                  elem.style.display = 'table-row';
                  isVisible = true;
                } else {
                  elem.style.display = 'none';
                  isVisible = false;
                }
              });

              toggleButton.textContent = isVisible ? 'Hide Trans' : 'Show Trans';
            });

            chorus.appendChild(toggleButton);
          }

          // Make sure translations are hidden by default
          translations.forEach(elem => {
            elem.style.display = 'none';
          });
        } else {
          // Larger screen - show translations and remove toggle button
          if (existingToggle) {
            existingToggle.remove();
          }

          translations.forEach(elem => {
            elem.style.display = '';
          });
        }
      }
    });
  }
});

// Add additional CSS for the persistent chorus
document.addEventListener('DOMContentLoaded', function() {
  // Add styles for wrappers and containers
  const style = document.createElement('style');
  style.textContent = `
    .persistent-chorus-wrapper {
      position: fixed;
      top: 4rem;
      left: 0;
      right: 0;
      z-index: 100;
      display: flex;
      justify-content: center;
      pointer-events: none;
      transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .persistent-chorus-wrapper.hidden {
      opacity: 0;
      transform: translateY(-100%);
      pointer-events: none;
    }

    .persistent-chorus-inner {
      box-sizing: border-box;
      pointer-events: auto;
    }

    .persistent-chorus {
      background-color: #fff;
      border-radius: 0.5rem;
      padding: 0.5rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      position: relative;
      margin-bottom: 1rem;
    }

    /* Mobile adjustments */
    @media screen and (max-width: 768px) {
      .persistent-chorus-wrapper {
        top: 3.5rem;
      }

      .persistent-chorus-inner {
        width: calc(100% - 2rem) !important;
        padding: 0 1rem !important;
      }

      .persistent-chorus .arabic {
        font-size: 160% !important;
      }

      .persistent-chorus .transliteration-phrase-by-phrase,
      .persistent-chorus .translation-phrase-by-phrase {
        font-size: 80% !important;
      }
    }

    /* Phone adjustments - force smaller Arabic */
    @media screen and (max-width: 767px) {
      .persistent-chorus .arabic {
        font-size: 120% !important;
      }
    }

    /* Small phone adjustments - force even smaller Arabic */
    @media screen and (max-width: 375px) {
      .persistent-chorus .arabic {
        font-size: 100% !important;
      }
    }


    /* Handle collapsed book sidebar */
    .book-menu-content.collapse-processed:not(.show) ~ .book-page .persistent-chorus-inner {
      max-width: calc(100% - 2rem) !important;
    }

    /* Print styles */
    @media print {
      .persistent-chorus-wrapper {
        display: none !important;
      }
    }

    /* Show/hide transitions */
    .persistent-chorus,
    .persistent-chorus-wrapper {
      transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .chorus-indicator {
      text-align: center;
      font-size: 0.8rem;
      color: #666;
      margin-bottom: 0.5rem;
    }

    /* Chorus toggle button */
    .chorus-toggle {
      position: absolute;
      top: 5px;
      right: 5px;
      background: rgba(255, 255, 255, 0.8);
      border: 1px solid #ccc;
      border-radius: 3px;
      padding: 2px 5px;
      font-size: 10px;
      color: #666;
      cursor: pointer;
      z-index: 10;
      transition: background-color 0.2s ease;
    }

    .chorus-toggle:hover {
      background-color: #f0f0f0;
    }
  `;

  document.head.appendChild(style);
});

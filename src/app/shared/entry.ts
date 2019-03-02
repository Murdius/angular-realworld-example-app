/*
 *    Copyright 2017 OICR
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */
import { Location } from '@angular/common';
import { AfterViewInit, Injectable, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatChipInputEvent, MatTabChangeEvent } from '@angular/material';
import { ActivatedRoute, NavigationEnd, Params, Router, RouterEvent } from '@angular/router/';
import { TabsetComponent } from 'ngx-bootstrap';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { Dockstore } from '../shared/dockstore.model';
import { Tag } from '../shared/swagger/model/tag';
import { WorkflowVersion } from '../shared/swagger/model/workflowVersion';
import { TrackLoginService } from '../shared/track-login.service';
import { DateService } from './date.service';
import { GA4GHFilesService } from './ga4gh-files/ga4gh-files.service';
import { ProviderService } from './provider.service';
import { SessionQuery } from './session/session.query';
import { SessionService } from './session/session.service';
import { UrlResolverService } from './url-resolver.service';
import { validationDescriptorPatterns, validationMessages } from './validationMessages.model';


@Injectable()
export abstract class Entry implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('entryTabs') entryTabs: TabsetComponent;
  protected shareURL: string;
  public starGazersClicked = false;
  private totalShare = 0;
  public title: string;
  protected _toolType: string;
  protected isLoggedIn: boolean;
  protected validVersions;
  protected defaultVersion;
  protected published: boolean;
  public labelPattern = validationDescriptorPatterns.label;
  public labelsEditMode: boolean;
  public error;
  public validTabs;
  public currentTab = 'info';
  public urlVersion;
  location: Location;
  public selectedVersion: (WorkflowVersion | Tag | null) = null;
  @Input() isWorkflowPublic = true;
  @Input() isToolPublic = true;
  public publicPage: boolean;
  public validationMessage = validationMessages;
  protected ngUnsubscribe: Subject<{}> = new Subject();
  protected selected = new FormControl(0);
  constructor(private trackLoginService: TrackLoginService,
    public providerService: ProviderService,
    public router: Router,
    public dateService: DateService,
    public urlResolverService: UrlResolverService,
    public activatedRoute: ActivatedRoute,
    public locationService: Location,
    protected sessionService: SessionService, protected sessionQuery: SessionQuery, protected gA4GHFilesService: GA4GHFilesService) {
    this.location = locationService;
    this.gA4GHFilesService.clearFiles();
  }

  ngOnInit() {
    this.subscriptions();
    this.router.events.pipe(filter(event => event instanceof NavigationEnd),
    takeUntil(this.ngUnsubscribe)).subscribe((event: RouterEvent) => {
        this.parseURL(event.url);
    });
    this.parseURL(this.router.url);
    this.sessionService.setPublicPage(this.isPublic());
    this.sessionQuery.isPublic$.pipe(takeUntil(this.ngUnsubscribe)).subscribe(publicPage => this.publicPage = publicPage);
    this.trackLoginService.isLoggedIn$.pipe(
      takeUntil(this.ngUnsubscribe)).subscribe(state => this.isLoggedIn = state);
  }

  private parseURL(url: String): void {
    if (this.isPublic()) {
      this.title = this.getEntryPathFromURL();
      this.urlVersion = this.getVersionFromURL();
      this.setupPublicEntry(url);
    } else {
      if (this.entryTabs) {
        this.selectTab(0);
      }
    }
  }

  getVerifiedLink(): string {
    return this.dateService.getVerifiedLink();
  }

  starGazersChange(): void {
    this.starGazersClicked = !this.starGazersClicked;
  }

  ngOnDestroy() {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  abstract subscriptions(): void;
  abstract setProperties(): void;
  abstract getValidVersions(): void;
  abstract publishDisable(): boolean;
  abstract refresh(): void;
  abstract publish(): void;
  abstract getDefaultVersionName(): string;
  abstract resetCopyBtn(): void;
  abstract isPublic(): boolean;
  abstract setupPublicEntry(url: String): void;

  toggleLabelsEditMode(): void {
    this.labelsEditMode = !this.labelsEditMode;
  }

  sumCounts(count): void {
    this.totalShare += count;
  }

  protected initTool(): void {
    this.setProperties();
    this.getValidVersions();
    this.chooseDefaultVersion();
    this.resetCopyBtn();
  }

  private chooseDefaultVersion(): void {
    let defaultVersionName = this.getDefaultVersionName();
    // if user did not specify a default version, use the latest version
    if (!defaultVersionName) {
      if (this.validVersions.length) {
        const last: number = this.validVersions.length - 1;
        defaultVersionName = this.validVersions[last].name;
      }
    }
    this.defaultVersion = this.getDefaultVersion(defaultVersionName);
  }

  private getDefaultVersion(defaultVersionName: string) {
    for (const version of this.validVersions) {
      if (version.name === defaultVersionName) {
        return version;
      }
    }
  }

  // Embed Discourse comments into page
  ngAfterViewInit() {
    if (this.publicPage) {
      (function() {
        const d = document.createElement('script'); d.type = 'text/javascript'; d.async = true;
        d.src = (<any>window).DiscourseEmbed.discourseUrl + 'javascripts/embed.js';
        (document.getElementsByTagName('head')[0] || document.getElementsByTagName('body')[0]).appendChild(d);
      })();
    }

    this.activatedRoute.queryParams.pipe(takeUntil(this.ngUnsubscribe)).subscribe((params: Params) => {
      const tabIndex = this.validTabs.indexOf(params['tab']);
      if (tabIndex > -1) {
        this.currentTab = this.validTabs[tabIndex];
      }
    });
  }

  /**
   * Given an array of WorkflowVersions or Tag, decide which one to return (displayed to the user)
   * 1. If the URL specifies a specific Tag or WorkflowVersion, choose to display that one.  Otherwise,
   * 2. If the default version is specified, choose to display the default version.  Otherwise,
   * 3. Choose the first version in the array (the last updated version?)
   * @param {((Array<WorkflowVersion | Tag>))} versions    All versions of an entry.
   * This is supposed to be (Array<WorkflowVersion> | Array<Tag>).
   * No idea why errors appear when attempted to do so.
   * @param {string} urlVersion  The version of the entry specified in the URL (possibly null or undefined)
   * @param {string} defaultVersion  The default version of an entry (possibly null or undefined)
   * @returns {((WorkflowVersion | Tag))}  The version to display to the user
   * @memberof Entry
   */
  public selectVersion(versions: (Array<WorkflowVersion | Tag>), urlVersion: string, defaultVersion: string): (WorkflowVersion | Tag) {
    if (!versions || versions.length === 0) {
      return null;
    }
    let foundVersion: (WorkflowVersion | Tag);
    if (urlVersion) {
      foundVersion = versions.find((version: (WorkflowVersion | Tag)) => version.name === urlVersion);
      if (foundVersion) {
        return foundVersion;
      }
    }
    if (defaultVersion) {
      foundVersion = versions.find((version: (WorkflowVersion | Tag)) => version.name === defaultVersion);
      if (foundVersion) {
        return foundVersion;
      }
    }

    // Select newest last_modified version, if it's the same, choose the top
    return versions.reduce((a, b) => b.last_modified > a.last_modified ? b : a);
  }

  public getEntryPathFromURL(): string {
    return this.urlResolverService.getEntryPathFromUrl();
  }

  public getVersionFromURL(): string {
    return this.urlResolverService.getVersionFromURL();
  }

  /**
   * Selects a tab of index tabIndex (like clicking on a tab)
   * @param {number} tabIndex - index of tab to select
   * @returns {void}
   */
  selectTab(tabIndex: number): void {
    this.selected.setValue(tabIndex);
  }

  /**
   * Updates the URL to include the tab and sets the tab
   * @param {number} tabIndex - index of tab to select
   * @returns {void}
   */
  abstract setEntryTab(tabName: string): void;

  /**
   * Updates the URL with both tab and version information
   * @returns {void}
   */
  updateUrl(entryPath: string, myEntry: string, entry: string): void {
    if (this.publicPage) {
      let currentPath = '';
      if (this.router.url.indexOf(myEntry) !== -1) {
        currentPath += '/' + myEntry + '/';
      } else {
        currentPath += '/' + entry + '/';
      }
      currentPath += entryPath;
      if (this.selectedVersion !== null) {
        currentPath += ':' + this.selectedVersion.name;
      }
      currentPath += '?tab=' + this.currentTab;
      this.location.replaceState(currentPath);
    }
  }

  /**
   * Sorts two entries by last modified, and then verified
   * @param {Tag|WorkflowVersion} a - version a
   * @param {Tag|WorkflowVersion} b - version b
   * @returns {number} - indicates order
   */
  entryVersionSorting(a: Tag|WorkflowVersion, b: Tag|WorkflowVersion): number {
    if (a.verified && !b.verified) {
      return -1;
    } else if (!a.verified && b.verified) {
      return 1;
    } else {
      if (a.last_modified > b.last_modified) {
        return -1;
      } else if (a.last_modified < b.last_modified) {
        return 1;
      } else {
        return 0;
      }
    }
  }

  selectedTabChange(matTabChangeEvent: MatTabChangeEvent) {
    this.selected.setValue(matTabChangeEvent.index);
    this.setEntryTab(matTabChangeEvent.tab.textLabel.toLowerCase());
  }


  /**
   * Sorts a list of versions by verified and then last_modified, returning a subset of the versions (1 default + 5 other versions max)
   * @param {Array<Tag|WorkflowVersion>} versions - Array of versions
   * @param {Tag|WorkflowVersion} defaultVersion - Default version of the entry
   * @returns {Array<any>} Sorted array of versions
   */
  getSortedVersions(versions: Array<Tag|WorkflowVersion>, defaultVersion: Tag|WorkflowVersion): Array<Tag|WorkflowVersion> {
    let sortedVersions: Array<Tag|WorkflowVersion> = [];

    // Sort versions by verified date and then last_modified
    sortedVersions = versions.slice().sort((a, b) => this.entryVersionSorting(a, b));

    // Get the top 6 versions
    const recentVersions: Array<Tag|WorkflowVersion> = sortedVersions.slice(0, 6);
    const index = recentVersions.indexOf(defaultVersion);

    // Deal with default version if it exists
    if (defaultVersion) {
      if (index === -1) {
        // Remove extra version if necessary
        if (recentVersions.length > 5) {
          recentVersions.splice(-1, 1);
        }
      } else {
        // Remove existing default version if exists
        recentVersions.splice(index, 1);
      }

      // Push default version to the top
      recentVersions.unshift(defaultVersion);
    }

    return recentVersions;
  }

  /**
   * Will decode the URL
   * @return {void}
   */
  decodeURL(type: string): void {
    const url = decodeURIComponent(window.location.href);
    const containersIndex = this.getIndexInURL('/' + type);
    const newPath = url.substring(containersIndex);
    this.location.replaceState(newPath);
  }

  /**
   * Determine the index of a string in the current URL
   * @return {number}
   */
  getIndexInURL(page: string): number {
    return window.location.href.indexOf(page);
  }

  /**
   * Determine the index of a string in the current URL, starting at an offset
   * @return {number}
   */
  getIndexInURLFrom(page: string, startFrom: number): number {
    return window.location.href.indexOf(page, startFrom);
  }

  /**
   * Deals with redirecting to canonical URL and running discourse call
   * @return {void}
   */
  redirectAndCallDiscourse(myPage: string): void {
    if (this.getIndexInURL(myPage) === -1) {
      let trimmedURL = window.location.href;

      // Decode the URL
      this.decodeURL(this._toolType);

      // Get index of /containers or /workflows
      const pageIndex = this.getPageIndex();

      // Get the URL for discourse
      const indexOfLastColon = this.getIndexInURLFrom(':', pageIndex);
      if (indexOfLastColon > 0) {
        trimmedURL = window.location.href.substring(0, indexOfLastColon);
      }

      // Initialize discourse urls
      (<any>window).DiscourseEmbed = {
        discourseUrl: Dockstore.DISCOURSE_URL,
        discourseEmbedUrl: decodeURIComponent(trimmedURL)
      };
    }
  }

  /**
   * Gets the index of /containers or /workflows from the URL
   * @return {number}
   */
  abstract getPageIndex(): number;

  /**
   * Go to the search page with a query preloaded
   * @param {string} searchValue Value to search for
   */
  goToSearch(searchValue: string): void {
    window.location.href = '/search?labels.value.keyword=' + searchValue + '&searchMode=files';
  }

  /**
   * Adds a label to the labels list
   * @param  event Add chip event
   */
  abstract addToLabels(event: MatChipInputEvent): void;

  /**
   * Removes a label from the list of labels (does not update in database)
   * @param  label label to remove
   */
  abstract removeLabel(label: any): void;

  /**
   * Cancels any unsaved label changes
   */
  abstract cancelLabelChanges(): void;
}
import NextLink from 'next/link';
import { MutateFunction, useMutation } from 'react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';

import Button from '@oracle/elements/Button';
import Chip from '@oracle/components/Chip';
import Dashboard from '@components/Dashboard';
import ErrorsType from '@interfaces/ErrorsType';
import Flex from '@oracle/components/Flex';
import FlexContainer from '@oracle/components/FlexContainer';
import InputModal from '@oracle/elements/Inputs/InputModal';
import Headline from '@oracle/elements/Headline';
import Link from '@oracle/elements/Link';
import Panel from '@oracle/components/Panel';
import PipelineType, {
  PipelineGroupingEnum,
  PipelineQueryEnum,
  PipelineStatusEnum,
  PipelineTypeEnum,
  PIPELINE_TYPE_LABEL_MAPPING,
} from '@interfaces/PipelineType';
import PrivateRoute from '@components/shared/PrivateRoute';
import ProjectType from '@interfaces/ProjectType';
import Spacing from '@oracle/elements/Spacing';
import Spinner from '@oracle/components/Spinner';
import Table from '@components/shared/Table';
import TagType from '@interfaces/TagType';
import TagsContainer from '@components/Tags/TagsContainer';
import Text from '@oracle/elements/Text';
import ToggleSwitch from '@oracle/elements/Inputs/ToggleSwitch';
import Toolbar from '@components/shared/Table/Toolbar';
import api from '@api';
import dark from '@oracle/styles/themes/dark';
import { BlockTypeEnum } from '@interfaces/BlockType';
import { Check, Circle, Clone, File, Open, Pause, PlayButtonFilled, Secrets } from '@oracle/icons';
import { ScheduleStatusEnum } from '@interfaces/PipelineScheduleType';
import { BORDER_RADIUS_SMALL } from '@oracle/styles/units/borders';
import { HEADER_HEIGHT } from '@components/shared/Header/index.style';
import { TableContainerStyle } from '@components/shared/Table/index.style';
import { PADDING_UNITS, UNIT } from '@oracle/styles/units/spacing';
import { capitalize, capitalizeRemoveUnderscoreLower } from '@utils/string';
import { displayErrorFromReadResponse, onSuccess } from '@api/utils/response';
import { filterQuery, queryFromUrl } from '@utils/url';
import { getNewPipelineButtonMenuItems } from '@components/Dashboard/utils';
import { goToWithQuery } from '@utils/routing';
import { pauseEvent } from '@utils/events';
import { sortByKey } from '@utils/array';
import { useModal } from '@context/Modal';
import { useError } from '@context/Error';

const sharedOpenButtonProps = {
  borderRadius: BORDER_RADIUS_SMALL,
  iconOnly: true,
  noBackground: true,
  noBorder: true,
  outline: true,
  padding: '4px',
};

function PipelineListPage() {
  const router = useRouter();
  const refTable = useRef(null);

  const [selectedPipeline, setSelectedPipeline] = useState<PipelineType>(null);
  const [searchText, setSearchText] = useState<string>(null);
  const [pipelinesEditing, setPipelinesEditing] = useState<{
    [uuid: string]: boolean;
  }>({});
  const [errors, setErrors] = useState<ErrorsType>(null);

  const q = queryFromUrl();
  const query = filterQuery(q, [
    PipelineQueryEnum.STATUS,
    PipelineQueryEnum.TAG,
    PipelineQueryEnum.TYPE,
  ]);
  const groupByQuery = q?.[PipelineQueryEnum.GROUP];
  const { data, mutate: fetchPipelines } = api.pipelines.list({
    ...query,
    include_schedules: 1,
  });
  const pipelines: PipelineType[] = useMemo(() => {
    let pipelinesFinal: PipelineType[] = data?.pipelines || [];
    if (searchText) {
      const lowercaseSearchText = searchText.toLowerCase();
      pipelinesFinal = pipelinesFinal.filter(({ name, description, uuid }) =>
         name?.toLowerCase().includes(lowercaseSearchText)
          || uuid?.toLowerCase().includes(lowercaseSearchText)
          || description?.toLowerCase().includes(lowercaseSearchText),
      );
    }

    return pipelinesFinal;
  }, [data?.pipelines, searchText]);

  const { data: dataProjects, mutate: fetchProjects } = api.projects.list();
  const project: ProjectType = useMemo(() => dataProjects?.projects?.[0], [dataProjects]);

  useEffect(() => {
    displayErrorFromReadResponse(data, setErrors);
  }, [data]);

  const useCreatePipelineMutation = (onSuccessCallback) => useMutation(
    api.pipelines.useCreate(),
    {
      onSuccess: (response: any) => onSuccess(
        response, {
          callback: ({
            pipeline: {
              uuid,
            },
          }) => {
            onSuccessCallback?.(uuid);
          },
          onErrorCallback: (response, errors) => setErrors({
            errors,
            response,
          }),
        },
      ),
    },
  );
  const [createPipeline, { isLoading: isLoadingCreate }]: [
    MutateFunction<any>,
    { isLoading: boolean },
  ] = useCreatePipelineMutation((pipelineUUID: string) => router.push(
    '/pipelines/[pipeline]/edit',
    `/pipelines/${pipelineUUID}/edit`,
  ));
  const [clonePipeline, { isLoading: isLoadingClone }]: [
    MutateFunction<any>,
    { isLoading: boolean },
  ] = useCreatePipelineMutation(() => fetchPipelines?.());

  const [updatePipeline, { isLoading: isLoadingUpdate }] = useMutation(
    (pipeline: PipelineType & {
      status?: ScheduleStatusEnum;
    }) => api.pipelines.useUpdate(pipeline.uuid)({ pipeline }),
    {
      onSuccess: (response: any) => onSuccess(
        response, {
          callback: ({
            pipeline: {
              uuid,
            },
          }) => {
            setPipelinesEditing(prev => ({
              ...prev,
              [uuid]: false,
            }));
            fetchPipelines();
            hideInputModal?.();
            setSelectedPipeline(null);
          },
          onErrorCallback: (response, errors) => {
            const pipelineUUID = response?.url_parameters?.pk;
            setPipelinesEditing(prev => ({
              ...prev,
              [pipelineUUID]: false,
            }));
            setErrors({
              errors,
              response,
            });
          },
        },
      ),
    },
  );
  const [deletePipeline, { isLoading: isLoadingDelete }] = useMutation(
    (uuid: string) => api.pipelines.useDelete(uuid)(),
    {
      onSuccess: (response: any) => onSuccess(
        response, {
          callback: () => {
            fetchPipelines?.();
          },
          onErrorCallback: (response, errors) => setErrors({
            errors,
            response,
          }),
        },
      ),
    },
  );

  const [showInputModal, hideInputModal] = useModal(({
    pipeline,
    pipelineDescription,
    pipelineName,
  }: {
    pipeline?: PipelineType;
    pipelineDescription?: string;
    pipelineName?: string;
  }) => (
    <InputModal
      isLoading={isLoadingUpdate}
      minWidth={UNIT * 55}
      noEmptyValue={!!pipelineName}
      onClose={hideInputModal}
      onSave={(value: string) => {
        const pipelineToUse = pipeline || selectedPipeline;

        if (pipelineToUse) {
          const selectedPipelineUUID = pipelineToUse.uuid;
          const pipelineUpdateRequestBody: PipelineType = {
            uuid: selectedPipelineUUID,
          };
          if (pipelineName) {
            pipelineUpdateRequestBody.name = value;
          } else {
            pipelineUpdateRequestBody.description = value;
          }

          setPipelinesEditing(prev => ({
            ...prev,
            [selectedPipelineUUID]: true,
          }));
          updatePipeline(pipelineUpdateRequestBody);
        }
      }}
      textArea={!pipelineName}
      title={pipelineName
        ? 'Rename pipeline'
        : 'Edit description'
      }
      value={pipelineName ? pipelineName : pipelineDescription}
    />
  ), {} , [
    isLoadingUpdate,
    selectedPipeline,
  ], {
    background: true,
    uuid: 'rename_pipeline_and_save',
  });

  const newPipelineButtonMenuItems = useMemo(() => getNewPipelineButtonMenuItems(createPipeline), [
    createPipeline,
  ]);

  const { data: dataTags } = api.tags.list();
  const tags: TagType[] = useMemo(() => sortByKey(dataTags?.tags || [], ({ uuid }) => uuid), [
    dataTags,
  ]);

  const toolbarEl = useMemo(() => (
    <Toolbar
      addButtonProps={{
        isLoading: isLoadingCreate,
        label: 'New',
        menuItems: newPipelineButtonMenuItems,
      }}
      deleteRowProps={{
        confirmationMessage: 'This is irreversible and will immediately delete everything associated \
          with the pipeline, including its blocks, triggers, runs, logs, and history.',
        isLoading: isLoadingDelete,
        item: 'pipeline',
        onDelete: () => {
          if (typeof window !== 'undefined'
            && window.confirm(
              `Are you sure you want to delete pipeline ${selectedPipeline?.uuid}?`,
            )
          ) {
            deletePipeline(selectedPipeline?.uuid);
          }
        },
      }}
      filterOptions={{
        status: Object.values(PipelineStatusEnum),
        tag: tags.map(({ uuid }) => uuid),
        type: Object.values(PipelineTypeEnum),
      }}
      filterValueLabelMapping={{
        tag: tags.reduce((acc, { uuid }) => ({
          ...acc,
          [uuid]: uuid,
        }), {}),
        type: PIPELINE_TYPE_LABEL_MAPPING,
      }}
      groupButtonProps={{
        groupByLabel: groupByQuery,
        menuItems: [
          {
            beforeIcon: groupByQuery === PipelineGroupingEnum.STATUS
              ? <Check
                fill={dark.content.default}
                size={UNIT * 1.5}
              />
              : <Circle muted size={UNIT * 1.5} />
            ,
            label: () => capitalize(PipelineGroupingEnum.STATUS),
            onClick: () => goToWithQuery({
              [PipelineQueryEnum.GROUP]: groupByQuery === PipelineGroupingEnum.STATUS
                ? null
                : PipelineGroupingEnum.STATUS,
            }, {
              pushHistory: true,
            }),
            uuid: 'Pipelines/GroupMenu/Status',
          },
          {
            beforeIcon: groupByQuery === PipelineGroupingEnum.TAG
              ? <Check
                fill={dark.content.default}
                size={UNIT * 1.5}
              />
              : <Circle muted size={UNIT * 1.5} />
            ,
            label: () => capitalize(PipelineGroupingEnum.TAG),
            onClick: () => goToWithQuery({
              [PipelineQueryEnum.GROUP]: groupByQuery === PipelineGroupingEnum.TAG
                ? null
                : PipelineGroupingEnum.TAG,
            }, {
              pushHistory: true,
            }),
            uuid: 'Pipelines/GroupMenu/Tag',
          },
          {
            beforeIcon: groupByQuery === PipelineGroupingEnum.TYPE
              ? <Check
                fill={dark.content.default}
                size={UNIT * 1.5}
              />
              : <Circle muted size={UNIT * 1.5} />
            ,
            label: () => capitalize(PipelineGroupingEnum.TYPE),
            onClick: () => goToWithQuery({
              [PipelineQueryEnum.GROUP]: groupByQuery === PipelineGroupingEnum.TYPE
                ? null
                : PipelineGroupingEnum.TYPE,
            }, {
              pushHistory: true,
            }),
            uuid: 'Pipelines/GroupMenu/Type',
          },
        ],
      }}
      moreActionsMenuItems={[
        {
          label: () => 'Rename pipeline',
          onClick: () => showInputModal({ pipelineName: selectedPipeline?.name }),
          uuid: 'Pipelines/MoreActionsMenu/Rename',
        },
        {
          label: () => 'Edit description',
          onClick: () => showInputModal({ pipelineDescription: selectedPipeline?.description }),
          uuid: 'Pipelines/MoreActionsMenu/EditDescription',
        },
      ]}
      query={query}
      searchProps={{
        onChange: setSearchText,
        value: searchText,
      }}
      secondaryActionButtonProps={{
        Icon: Clone,
        confirmationDescription: 'Cloning the selected pipeline will create a new pipeline with the same \
          configuration and code blocks. The blocks use the same block files as the original pipeline. \
          Pipeline triggers, runs, backfills, and logs are not copied over to the new pipeline.',
        confirmationMessage: `Do you want to clone the pipeline ${selectedPipeline?.uuid}?`,
        isLoading: isLoadingClone,
        onClick: () => clonePipeline({
          pipeline: { clone_pipeline_uuid: selectedPipeline?.uuid },
        }),
        openConfirmationDialogue: true,
        tooltip: 'Clone pipeline',
      }}
      selectedRowId={selectedPipeline?.uuid}
      setSelectedRow={setSelectedPipeline}
    />
  ), [
    clonePipeline,
    deletePipeline,
    groupByQuery,
    isLoadingClone,
    isLoadingCreate,
    isLoadingDelete,
    newPipelineButtonMenuItems,
    query,
    searchText,
    selectedPipeline?.description,
    selectedPipeline?.name,
    selectedPipeline?.uuid,
    showInputModal,
    tags,
  ]);

  const [showError] = useError(null, {}, [], {
    uuid: 'pipelines/list',
  });
  const [updateProjectBase, { isLoading: isLoadingUpdateProject }]: any = useMutation(
    api.projects.useUpdate(project?.name),
    {
      onSuccess: (response: any) => onSuccess(
        response, {
          callback: () => {
            fetchProjects();
          },
          onErrorCallback: (response, errors) => showError({
            errors,
            response,
          }),
        },
      ),
    },
  );
  const updateProject = useCallback((payload: {
    help_improve_mage?: boolean;
  }) => updateProjectBase({
    project: payload,
  }), [updateProjectBase]);

  const [showHelpMageModal, hideHelpMageModal] = useModal(() => (
    <Panel maxWidth={UNIT * 60}>
      <Spacing mb={1}>
        <Headline>
          Help improve Mage
        </Headline>
      </Spacing>

      <Spacing mb={PADDING_UNITS}>
        <Text default>
          Please contribute usage statistics to help improve the developer experience
          for you and everyone in the community 🤝.
        </Text>
      </Spacing>

      <Spacing mb={PADDING_UNITS}>
        <Panel success>
          <FlexContainer alignItems="center">
            <Secrets size={UNIT * 5} success />
            <Spacing mr={1} />
            <Flex>
              <Text>
                All usage statistics are completely anonymous.
                It’s impossible for Mage to know which statistics belongs to whom.
              </Text>
            </Flex>
          </FlexContainer>
        </Panel>
      </Spacing>

      <Spacing mb={PADDING_UNITS}>
        <Text default>
          By opting into sending usage statistics to <Link
            href="https://www.mage.ai"
            openNewWindow
          >
            Mage
          </Link>, it’ll help the team and community of contributors (<Link
            href="https://www.mage.ai/chat"
            openNewWindow
          >
            Magers
          </Link>)
          learn what’s going wrong with the tool and what improvements can be made.
        </Text>
      </Spacing>

      <Spacing mb={PADDING_UNITS}>
        <Text default>
          In addition to helping reduce potential errors,
          you’ll help inform which features are useful and which need work.
        </Text>
      </Spacing>

      <Spacing mb={PADDING_UNITS}>
        <FlexContainer
          alignItems="center"
          justifyContent="space-between"
        >
          <Text bold>
            I want to help make Mage more powerful for everyone
          </Text>

          <Spacing mr={PADDING_UNITS} />

          <ToggleSwitch
            checked
            onCheck={() => {
              if (typeof window !== 'undefined') {
                if (window.confirm(
                  'Are you sure you don’t want to help everyone in the community?',
                )) {
                  updateProject({
                    help_improve_mage: false,
                  }).then(() => hideHelpMageModal());
                }
              } else {
                updateProject({
                  help_improve_mage: false,
                }).then(() => hideHelpMageModal());
              }
            }}
          />
        </FlexContainer>
      </Spacing>

      {isLoadingUpdateProject && (
        <Spacing mb={PADDING_UNITS}>
          <Spinner inverted />
        </Spacing>
      )}

      <Spacing mb={PADDING_UNITS}>
        <Text muted small>
          To learn more about how this works, please check out the <Link
            href="https://docs.mage.ai/contributing/statistics/overview"
            openNewWindow
            small
          >
            documentation
          </Link>.
        </Text>
      </Spacing>

      <Button
        onClick={() => updateProject({
          help_improve_mage: true,
        }).then(() => hideHelpMageModal())}
        secondary
      >
        Close
      </Button>
    </Panel>
  ), {}, [
    project,
  ], {
    background: true,
    hideCallback: () => {
      updateProject({
        help_improve_mage: true,
      });
    },
    uuid: 'help_mage',
  });

  useEffect(() => {
    if (project && project?.help_improve_mage === null) {
      showHelpMageModal();
    }
  }, [
    project,
    showHelpMageModal,
  ]);

  const {
    rowGroupHeaders,
    rowsGroupedByIndex,
  } = useMemo(() => {
    const mapping = {};

    pipelines?.forEach((pipeline, idx: number) => {
      let value = pipeline[groupByQuery];

      if (PipelineGroupingEnum.STATUS === groupByQuery) {
        const { schedules = [] } = pipeline;
        // TODO (tommy dang): when is the pipeline status RETRY?
        const schedulesCount = schedules.length;
        const isActive = schedules.find(({ status }) => ScheduleStatusEnum.ACTIVE === status);
        value = isActive
          ? PipelineStatusEnum.ACTIVE
          : schedulesCount >= 1 ? PipelineStatusEnum.INACTIVE : PipelineStatusEnum.NO_SCHEDULES;

      } else if (PipelineGroupingEnum.TAG === groupByQuery) {
        const pt = pipeline?.tags;
        if (pt) {
          value = sortByKey(pipeline.tags, uuid => uuid).join(', ');
        } else {
          value = '';
        }
      }

      if (!mapping[value]) {
        mapping[value] = [];
      }

      mapping[value].push(idx);
    });

    const arr = [];
    const headers = [];

    if (PipelineGroupingEnum.STATUS === groupByQuery) {
      Object.values(PipelineStatusEnum).forEach((val) => {
        arr.push(mapping[val]);
        headers.push(capitalizeRemoveUnderscoreLower(val));
      });
    } else if (PipelineGroupingEnum.TAG === groupByQuery) {
      sortByKey(Object.keys(mapping), uuid => uuid).forEach((val: string) => {
        arr.push(mapping[val]);
        if (val) {
          headers.push(val.split(', ').map((v: string, idx: number) => (
            <>
              <div
                key={`${v}-${idx}-spacing`}
                style={{
                  marginLeft: idx >= 1 ? 4 : 0,
                }}
              />
              <Chip key={`${v}-${idx}`} small>
                <Text>
                  {v}
                </Text>
              </Chip>
            </>
          )));
        } else {
          headers.push('No tags');
        }
      });
    } else if (PipelineGroupingEnum.TYPE === groupByQuery) {
      Object.values(PipelineTypeEnum).forEach((val) => {
        arr.push(mapping[val]);
        headers.push(PIPELINE_TYPE_LABEL_MAPPING[val]);
      });
    }

    return {
      rowGroupHeaders: headers,
      rowsGroupedByIndex: arr,
    };
  }, [
    groupByQuery,
    pipelines,
  ]);

  return (
    <Dashboard
      errors={errors}
      setErrors={setErrors}
      subheaderChildren={toolbarEl}
      title="Pipelines"
      uuid="pipelines/index"
    >
      {pipelines?.length === 0
        ? (
          <Spacing px ={3} py={1}>
            {!data
              ?
                <Spinner inverted large />
              :
                <Text bold default monospace muted>
                  No pipelines available
                </Text>
            }
          </Spacing>
        ): (
          <TableContainerStyle
            includePadding={!!groupByQuery}
            // Height of table = viewport height - (header height + subheader height)
            maxHeight={`calc(100vh - ${HEADER_HEIGHT + 74}px)`}
          >
            <Table
              columnFlex={[null, null, null, 2, null, null, 1, null, null, null]}
              columns={[
                {
                  label: () => '',
                  uuid: 'action',
                },
                {
                  uuid: capitalize(PipelineGroupingEnum.STATUS),
                },
                {
                  uuid: 'Name',
                },
                {
                  uuid: 'Description',
                },
                {
                  uuid: capitalize(PipelineGroupingEnum.TYPE),
                },
                {
                  uuid: 'Updated at',
                },
                {
                  uuid: 'Tags',
                },
                {
                  uuid: 'Blocks',
                },
                {
                  uuid: 'Triggers',
                },
                {
                  center: true,
                  label: () => '',
                  uuid: 'Actions',
                },
              ]}
              isSelectedRow={(rowIndex: number) => pipelines[rowIndex]?.uuid === selectedPipeline?.uuid}
              onClickRow={(rowIndex: number) => setSelectedPipeline(prev => {
                const pipeline = pipelines[rowIndex];

                return (prev?.uuid !== pipeline?.uuid) ? pipeline : null;
              })}
              onDoubleClickRow={(rowIndex: number) => {
                router.push(
                    '/pipelines/[pipeline]/edit',
                    `/pipelines/${pipelines[rowIndex].uuid}/edit`,
                );
              }}
              ref={refTable}
              renderRightClickMenuItems={(rowIndex: number) => {
                const selectedPipeline = pipelines[rowIndex];

                return [
                  {
                    label: () => 'Edit description',
                    onClick: () => showInputModal({
                      pipeline: selectedPipeline,
                      pipelineDescription: selectedPipeline?.description,
                    }),
                    uuid: 'edit_description',
                  },
                  {
                    label: () => 'Rename',
                    onClick: () => showInputModal({
                      pipeline: selectedPipeline,
                      pipelineName: selectedPipeline?.name,
                    }),
                    uuid: 'rename',
                  },
                  {
                    label: () => 'Clone',
                    onClick: () => clonePipeline({
                      pipeline: {
                        clone_pipeline_uuid: selectedPipeline?.uuid,
                      },
                    }),
                    uuid: 'clone',
                  },
                  {
                    label: () => 'Add/Remove tags',
                    onClick: () => {
                      router.push(
                        '/pipelines/[pipeline]/settings',
                        `/pipelines/${selectedPipeline?.uuid}/settings`,
                      );
                    },
                    uuid: 'add_tags',
                  },
                  {
                    label: () => 'Delete',
                    onClick: () => {
                      if (typeof window !== 'undefined'
                        && window.confirm(
                          `Are you sure you want to delete pipeline ${selectedPipeline?.uuid}?`,
                        )
                      ) {
                        deletePipeline(selectedPipeline?.uuid);
                      }
                    },
                    uuid: 'delete',
                  },
                ];
              }}
              rowGroupHeaders={rowGroupHeaders}
              rows={pipelines.map((pipeline, idx) => {
                const {
                  blocks,
                  description,
                  schedules,
                  tags,
                  type,
                  updated_at: updatedAt,
                  uuid,
                } = pipeline;
                const blocksCount = blocks.filter(({ type }) => BlockTypeEnum.SCRATCHPAD !== type).length;
                const schedulesCount = schedules.length;
                const isActive = schedules.find(({ status }) => ScheduleStatusEnum.ACTIVE === status);

                const tagsEl = (
                  <div key={`pipeline_tags_${idx}`}>
                    <TagsContainer
                      tags={tags?.map(tag => ({ uuid: tag }))}
                    />
                  </div>
                );

                return [
                  (schedulesCount >= 1 || !!pipelinesEditing[uuid])
                    ? (
                      <Button
                        iconOnly
                        loading={!!pipelinesEditing[uuid]}
                        noBackground
                        noBorder
                        noPadding
                        onClick={(e) => {
                          pauseEvent(e);
                          setPipelinesEditing(prev => ({
                            ...prev,
                            [uuid]: true,
                          }));
                          updatePipeline({
                            ...pipeline,
                            status: isActive
                              ? ScheduleStatusEnum.INACTIVE
                              : ScheduleStatusEnum.ACTIVE,
                          });
                        }}
                      >
                        {isActive
                          ? <Pause muted size={2 * UNIT} />
                          : <PlayButtonFilled default size={2 * UNIT} />
                        }
                      </Button>
                    )
                    : null
                  ,
                  <Text
                    default={!isActive}
                    key={`pipeline_status_${idx}`}
                    monospace
                    success={!!isActive}
                  >
                    {isActive
                      ? ScheduleStatusEnum.ACTIVE
                      : schedulesCount >= 1 ? ScheduleStatusEnum.INACTIVE : 'no schedules'
                    }
                  </Text>,
                  <NextLink
                    as={`/pipelines/${uuid}`}
                    href="/pipelines/[pipeline]"
                    key={`pipeline_name_${idx}`}
                    passHref
                  >
                    <Link sameColorAsText>
                      {uuid}
                    </Link>
                  </NextLink>,
                  <Text
                    default
                    key={`pipeline_description_${idx}`}
                    title={description}
                    width={UNIT * 90}
                  >
                    {description}
                  </Text>,
                  <Text
                    key={`pipeline_type_${idx}`}
                  >
                    {PIPELINE_TYPE_LABEL_MAPPING[type]}
                  </Text>,
                  <Text
                    key={`pipeline_updated_at_${idx}`}
                    title={updatedAt}
                  >
                    {updatedAt ? updatedAt.slice(0, -3) : <>&#8212;</>}
                  </Text>,
                  tagsEl,
                  <Text
                    default={blocksCount === 0}
                    key={`pipeline_block_count_${idx}`}
                    monospace
                  >
                    {blocksCount}
                  </Text>,
                  <Text
                    default={schedulesCount === 0}
                    key={`pipeline_trigger_count_${idx}`}
                    monospace
                  >
                    {schedulesCount}
                  </Text>,
                  <Flex
                    flex={1} justifyContent="flex-end"
                    key={`chevron_icon_${idx}`}
                  >
                    <Button
                      {...sharedOpenButtonProps}
                      onClick={() => {
                        router.push(
                          '/pipelines/[pipeline]',
                          `/pipelines/${uuid}`,
                        );
                      }}
                      title="Detail"
                    >
                      <Open default size={2 * UNIT} />
                    </Button>
                    <Spacing mr={1} />
                    <Button
                      {...sharedOpenButtonProps}
                      onClick={() => {
                        router.push(
                          '/pipelines/[pipeline]/logs',
                          `/pipelines/${uuid}/logs`,
                        );
                      }}
                      title="Logs"
                    >
                      <File default size={2 * UNIT} />
                    </Button>
                  </Flex>,
                ];
              })}
              rowsGroupedByIndex={rowsGroupedByIndex}
              stickyHeader
            />
          </TableContainerStyle>
        )
      }
    </Dashboard>
  );
}

PipelineListPage.getInitialProps = async () => ({});

export default PrivateRoute(PipelineListPage);
